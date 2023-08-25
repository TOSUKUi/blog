---
title: nginxでletsencryptを使う(gcloud dnsのdns-1-challenge)
author: amemiya
pubDatetime: 2023-08-20T12:09:04Z
postSlug: nginx-letsencrypt
featured: true
draft: false
tags: [自宅サーバー,VPN,Wireguard,自宅クラウド計画,nginx,google-dns,let's encrypt,dns01]
ogImage: ""
description: nginxでletsencryptを使う方法
canonicalURL: https://blog.tosukui.xyz/posts/nginx-letsencrypt
---

# NginxでLetsEncryptを使う

今回はワイルドカード証明書を使うため、dns01-challengeの設定をする

## gcloud-dnsのdns1-challengeを使うのでそれ系のプラグインを入れておく
```sh
sudo su -
apt update
apt install -y nginx certbot python3-certbot-nginx python3-certbot-dns-google
```

## gcloud-dnsの設定

### ゾーンの設定
一旦GCPのPROJECT名を`myproject`とする

cloud-dnsで自分のドメインのゾーンを設定する。

例 `domain-com`

適当なサービスでドメインをとったら、そのNSを以下の通りに設定する。
```
ns-cloud-a1.googledomains.com
ns-cloud-a2.googledomains.com
ns-cloud-a3.googledomains.com
ns-cloud-a4.googledomains.com
```

### サービスアカウントなどの設定

```sh
PROJECT_ID=myproject-id
gcloud iam service-accounts create dns01-solver --display-name "dns01-solver"
```

```
gcloud projects add-iam-policy-binding $PROJECT_ID \
   --member serviceAccount:dns01-solver@$PROJECT_ID.iam.gserviceaccount.com \
   --role roles/dns.admin
```
```
gcloud iam service-accounts create dns01-solver
```

サービスアカウントのシークレットを作っておく

```
gcloud iam service-accounts keys create key.json \
   --iam-account dns01-solver@$PROJECT_ID.iam.gserviceaccount.com
```

## certbotの設定

以下のようにドメインを指定し、issueingを行う

`key.json`はサービスアカウントのシークレット
```sh
certbot certonly --dns-google  --dns-google-credentials key.json -d *.domain.com
```

すると、`/etc/letsencrypt/live`以下に鍵類が生成される。


## nginxの設定

コンフィグファイルを以下のように設定

`conf.d/https.conf`
```conf

server {
    listen 443 ssl;
    server_name *.domain.com;
    ssl_certificate_key /etc/letsencrypt/live/privkey.pem
    ssl_certificate /etc/letsencrypt/live/fullchain.pem

    # 好きなコンテンツ
}
```


## 認証鍵を定期更新するようにする
以下のコマンドをcronに適当に登録すれば、期限が1ヶ月以内になったタイミングで再度チャレンジしてくれる
```sh
certbot renew
```

