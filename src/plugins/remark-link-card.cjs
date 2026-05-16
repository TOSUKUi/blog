const { visit } = require("unist-util-visit");
const ogs = require("open-graph-scraper");
const path = require("path");
const { writeFile, access, mkdir } = require("fs").promises;
const fetch = require("node-fetch");
const sanitize = require("sanitize-filename");
const he = require("he");

const defaultSaveDirectory = "public";
const defaultOutputDirectory = "/remark-link-card/";
const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

const rlc = options => {
  return async tree => {
    const transformers = [];
    visit(tree, "paragraph", (paragraphNode, index) => {
      if (paragraphNode.children.length !== 1) {
        return tree;
      }

      if (paragraphNode && paragraphNode.data !== undefined) {
        return tree;
      }

      visit(paragraphNode, "text", textNode => {
        const urls = textNode.value.match(
          /(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/g
        );
        if (urls && urls.length === 1) {
          transformers.push(async () => {
            const data = await fetchData(urls[0], options);
            const linkCardHtml = createLinkCard(data);
            const linkCardNode = {
              type: "html",
              value: linkCardHtml,
            };

            tree.children.splice(index, 1, linkCardNode);
          });
        }
      });
    });

    try {
      await Promise.all(transformers.map(t => t()));
    } catch (error) {
      console.error(`[remark-link-card] Error: ${error}`);
    }

    return tree;
  };
};

const getOpenGraph = async (targetUrl, ogOptions = {}) => {
  try {
    const { result } = await ogs({
      url: targetUrl,
      timeout: 10000,
      ...ogOptions,
    });
    return result;
  } catch (error) {
    const requestUrl =
      error && error.result && error.result.requestUrl
        ? error.result.requestUrl
        : targetUrl;
    const reason =
      error && error.result && error.result.error ? error.result.error : error;
    console.error(
      `[remark-link-card] Error: Failed to get the Open Graph data of ${requestUrl} due to ${reason}.`
    );
    return undefined;
  }
};

const normalizeOgImages = ogImage => {
  if (!ogImage) {
    return [];
  }

  const rawImages = Array.isArray(ogImage) ? ogImage : [ogImage];
  return rawImages
    .map(image => {
      if (!image) {
        return undefined;
      }

      if (typeof image === "string") {
        return { url: image };
      }

      if (typeof image.url === "string") {
        return image;
      }

      return undefined;
    })
    .filter(Boolean);
};

const isAmazonDomain = value => {
  if (!value) {
    return false;
  }

  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "amzn.to" ||
      hostname === "amazon.com" ||
      hostname.endsWith(".amazon.com") ||
      hostname === "amazon.co.jp" ||
      hostname.endsWith(".amazon.co.jp")
    );
  } catch (_error) {
    return value.includes("amzn.to") || value.includes("amazon.");
  }
};

const isAmazonShortUrl = value => {
  if (!value) {
    return false;
  }

  try {
    return new URL(value).hostname === "amzn.to";
  } catch (_error) {
    return value.includes("amzn.to");
  }
};

const getRequestHeaders = targetUrl => {
  if (!isAmazonDomain(targetUrl)) {
    return undefined;
  }

  return {
    "user-agent": browserUserAgent,
  };
};

const getOpenGraphOptions = targetUrl => {
  const headers = getRequestHeaders(targetUrl);
  const base = {
    headers,
    followRedirect: true,
    maxRedirects: 10,
  };

  if (!isAmazonDomain(targetUrl)) {
    return base;
  }

  return {
    ...base,
    // Amazon pages often exceed OGS default (1MB) before meta tags are parsed.
    downloadLimit: 5_000_000,
  };
};

const resolveRedirectUrl = async (targetUrl, headers, redirectsLeft = 5) => {
  if (redirectsLeft <= 0) {
    return targetUrl;
  }

  try {
    // First try normal redirect follow and take the final URL.
    const followedResponse = await fetch(targetUrl, {
      headers,
      redirect: "follow",
      follow: 10,
      timeout: 10000,
    });
    if (followedResponse && followedResponse.url) {
      return followedResponse.url;
    }

    // Fallback: manual single-step redirect resolution.
    const response = await fetch(targetUrl, {
      headers,
      redirect: "manual",
      timeout: 10000,
    });

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get("location")
    ) {
      const redirectedUrl = new URL(
        response.headers.get("location"),
        targetUrl
      ).toString();
      return resolveRedirectUrl(redirectedUrl, headers, redirectsLeft - 1);
    }
  } catch (error) {
    console.error(
      `[remark-link-card] Error: Failed to resolve redirect for ${targetUrl}\n ${error}`
    );
  }

  return targetUrl;
};

const resolveUrlForScrape = async targetUrl => {
  if (!isAmazonShortUrl(targetUrl)) {
    return targetUrl;
  }

  return resolveRedirectUrl(targetUrl, getRequestHeaders(targetUrl));
};

const scoreAmazonImage = image => {
  const url = image.url;
  let score = 0;

  const widthToken =
    url.match(/_SX(\d+)/i) || url.match(/_US(\d+)/i) || url.match(/_UX(\d+)/i);
  const heightToken =
    url.match(/_SY(\d+)/i) || url.match(/_UY(\d+)/i) || url.match(/_SS(\d+)/i);
  const tokenWidth = widthToken ? Number(widthToken[1]) : undefined;
  const tokenHeight = heightToken ? Number(heightToken[1]) : undefined;

  if (/\/images\/I\/|\/I\//.test(url)) {
    score += 60;
  }

  if (/_SX\d+|_SY\d+|_AC_|_QL\d+|_ML\d+/.test(url)) {
    score += 40;
  }

  if (/\.jpe?g($|\?)/i.test(url)) {
    score += 20;
  }

  if (typeof image.width === "number" && image.width >= 100) {
    score += 10;
  }

  if (typeof image.height === "number" && image.height >= 100) {
    score += 10;
  }

  if (typeof tokenWidth === "number" && tokenWidth >= 300) {
    score += 60;
  } else if (typeof tokenWidth === "number" && tokenWidth >= 150) {
    score += 30;
  } else if (typeof tokenWidth === "number" && tokenWidth <= 80) {
    score -= 120;
  }

  if (typeof tokenHeight === "number" && tokenHeight >= 300) {
    score += 60;
  } else if (typeof tokenHeight === "number" && tokenHeight >= 150) {
    score += 30;
  } else if (typeof tokenHeight === "number" && tokenHeight <= 80) {
    score -= 120;
  }

  if (/_AC_US\d{1,2}_|_US\d{1,2}_|_SS\d{1,2}_|_SR\d{1,3},\d{1,3}_/i.test(url)) {
    score -= 120;
  }

  if (
    /nav-sprite|transparent-pixel|spinner|kindle-app-logo|QR-store-link|samplePlayers|PrimeVideo_GW/i.test(
      url
    )
  ) {
    score -= 100;
  }

  if (/\.svg($|\?)/i.test(url) || /\.gif($|\?)/i.test(url)) {
    score -= 40;
  }

  return score;
};

const pickOgImage = (targetUrl, ogImage) => {
  const candidates = normalizeOgImages(ogImage);
  if (candidates.length === 0) {
    return undefined;
  }

  if (!isAmazonDomain(targetUrl)) {
    return candidates[0];
  }

  return [...candidates].sort(
    (a, b) => scoreAmazonImage(b) - scoreAmazonImage(a)
  )[0];
};

const fetchData = async (targetUrl, options) => {
  const scrapedUrl = await resolveUrlForScrape(targetUrl);
  const ogResult = await getOpenGraph(
    scrapedUrl,
    getOpenGraphOptions(scrapedUrl)
  );
  const parsedUrl = new URL(scrapedUrl);
  const title =
    (ogResult && ogResult.ogTitle && he.encode(ogResult.ogTitle)) ||
    parsedUrl.hostname;
  const description =
    (ogResult && ogResult.ogDescription && he.encode(ogResult.ogDescription)) ||
    "";
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}`;
  let faviconSrc = "";
  if (options && options.cache) {
    const faviconFilename = await downloadImage(
      faviconUrl,
      path.join(process.cwd(), defaultSaveDirectory, defaultOutputDirectory)
    );
    faviconSrc =
      faviconFilename && path.join(defaultOutputDirectory, faviconFilename);
  } else {
    faviconSrc = faviconUrl;
  }

  const selectedOgImage = pickOgImage(scrapedUrl, ogResult && ogResult.ogImage);
  let ogImageSrc = "";
  if (selectedOgImage && selectedOgImage.url) {
    if (options && options.cache) {
      const imageFilename = await downloadImage(
        selectedOgImage.url,
        path.join(process.cwd(), defaultSaveDirectory, defaultOutputDirectory)
      );
      ogImageSrc =
        imageFilename && path.join(defaultOutputDirectory, imageFilename);
    } else {
      ogImageSrc = selectedOgImage.url;
    }
  }

  const ogImageAlt =
    (selectedOgImage &&
      selectedOgImage.alt &&
      he.encode(selectedOgImage.alt)) ||
    title;

  let displayUrl =
    options && options.shortenUrl ? parsedUrl.hostname : targetUrl;

  try {
    displayUrl = decodeURI(displayUrl);
  } catch (error) {
    console.error(
      `[remark-link-card] Error: Cannot decode url: "${targetUrl}"\n ${error}`
    );
  }

  return {
    title,
    description,
    faviconSrc,
    ogImageSrc,
    ogImageAlt,
    displayUrl,
    url: targetUrl,
  };
};

const createLinkCard = data => {
  const faviconElement = data.faviconSrc
    ? `<img class="rlc-favicon" src="${data.faviconSrc}" alt="${data.title} favicon" width="16" height="16">`.trim()
    : "";

  const descriptionElement = data.description
    ? `<div class="rlc-description">${data.description}</div>`
    : "";

  const imageElement = data.ogImageSrc
    ? `<div class="rlc-image-container">
      <img class="rlc-image" src="${data.ogImageSrc}" alt="${data.ogImageAlt}" />
    </div>`.trim()
    : "";

  const outputHTML = `
<a class="rlc-container" href="${data.url}">
  <div class="rlc-info">
    <div class="rlc-title">${data.title}</div>
    ${descriptionElement}
    <div class="rlc-url-container">
      ${faviconElement}
      <span class="rlc-url">${data.displayUrl}</span>
    </div>
  </div>
  ${imageElement}
</a>
`.trim();

  return outputHTML;
};

const downloadImage = async (url, saveDirectory) => {
  let targetUrl;
  try {
    targetUrl = new URL(url);
  } catch (error) {
    console.error(
      `[remark-link-card] Error: Failed to parse url "${url}"\n ${error}`
    );
    return undefined;
  }

  const filename = sanitize(decodeURI(targetUrl.href));
  const saveFilePath = path.join(saveDirectory, filename);

  try {
    await access(saveFilePath);
    return filename;
  } catch (_error) {}

  try {
    await access(saveDirectory);
  } catch (_error) {
    await mkdir(saveDirectory, { recursive: true });
  }

  try {
    const response = await fetch(targetUrl.href, {
      headers: {
        "User-Agent": browserUserAgent,
      },
      timeout: 10000,
    });
    const buffer = await response.buffer();
    await writeFile(saveFilePath, buffer);
  } catch (error) {
    console.error(
      `[remark-link-card] Error: Failed to download image from ${targetUrl.href}\n ${error}`
    );
    return undefined;
  }

  return filename;
};

module.exports = rlc;
module.exports._private = {
  normalizeOgImages,
  pickOgImage,
  scoreAmazonImage,
  isAmazonDomain,
  isAmazonShortUrl,
  resolveUrlForScrape,
};
