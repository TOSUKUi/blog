---
title: traefikでリバースプロキシ構築
author: amemiya
pubDatetime: 2024-10-13T16:26:19+09
postSlug: traefik-reverse-proxy
featured: true
draft: false
tags: [自宅サーバー,自宅クラウド計画,traefik]
ogImage: ""
description: Traefikでリバースプロキシを構築する方法
canonicalURL: https://blog.tosukui.xyz/posts/traefik-reverse-proxy
---

# Traefikでリバースプロキシ構築
## Traefikとは
https://github.com/traefik/traefik

traefikとは高効率かつ、現代のコンテナ・マイクロサービスネイティブなリバースプロキシである

traefikは、サービスが追加されるたび、サービスディスカバリによって自動でプロキシが構築されるようになっており、

例として、事前にdockerのソケットに繋いでおくと、dockerのlabelに`traefik.enable=true`があるものを自動でディスカバリし、
以下のラベルの`hostname`でリバースプロキシしてくれるようになる
```
traefik.http.routers.service名.rule(`hostname`)
```

つまり、後からサービスをどんどん追加していっても本体のコンフィグは触る必要がない

nginxのようにサービスを追加するたびにコンフィグをいじる必要はないのが現代のマイクロサービス向きといえる

## Traefikをインストールしテストする
今回はDockerにて導入

traefikでhttpbinサーバーとnginxサーバーにプロキシすることを考える

下図は頑張ってmermaidで書いた図

![hogefuga](/assets/output-1.png)

まずTraefikの設定を行うが、configファイルは`traefik.yml`という名前で作成する
最終的なディレクトリ構成は以下の予定とする。
```
.
├── docker-compose.yml
└── traefik.yml
```

### Traefikのコンフィグを作成する

Traefikサーバーのコンフィグは、
- ログ設定
- プロキシで利用するプロバイダー設定
- プロキシ設定
- tls設定
- ダッシュボード設定
などがある。

なお、これらはdocker-compose.ymlの起動時のコマンドなどでも設定可能だ

`traefik.yml`は以下のとおりに設定した
```yaml

entryPoints:
  http:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: https
          scheme: https
  https:
    address: ":443"
    asDefault: true
    http:
      tls:
        certResolver: letsencrypt

  traefik:
    address: ":8080"


accessLog:
  filePath: /var/log/traefik-access.log
log:
  level: INFO
  filePath: /var/log/traefik.log

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: external

api:
  dashboard: true
  insecure: true


certificatesResolvers:
  letsencrypt:
    acme:
      email: <email>
      tlsChallenge: true
      storage: /letsencrypt/acme.json
```
- `entryPoints`: プロキシ設定。今回は80と443と8080を受け付ける設定にした(`traefik`という名前のentrypointsは強制的にダッシュボードのポートになる)
- `accessLog`: アクセスログの有無と、吐き出す場所を設定
- `log`: システムログの有無と、吐き出す場所、ログレベルを設定
- `providers`: プロキシをする際に連携するバックエンド。docker, kubernetes proxy, nomad, yamlファイルによるupstream直接指定などと連携可能
- `api`: ダッシュボード公開するか、またダッシュボードをhttpリクエスト許可するかを指定。めんどいので8080をあけて中からしかアクセスできなくした。
- `certificatesResolver`: tls証明書の更新設定。今回はletsencryptを使う設定にした。tlsChallengeなのでワイルドカード証明書はできないが、設定はめちゃ簡単

なお、上記の設定は全てdocker run時のcommandでも設定が可能だ。

### Traefikのdockerコンテナを立てる

現時点のディレクトリ構成
```
.
├── docker-compose.yml
└── traefik.yml
```
まずは、以下のとおりtraefikサービスのみたててみる

docker-compose.yml
```yaml
services:
  traefik:
    image: traefik:v3.0
    ports:
      - 80:80
      - 443:443
      - 8080:8080
    networks:
      - proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - letsencrypt:/letsencrypt
      - /var/log:/var/log
      - ./traefik.yml:/etc/traefik/traefik.yml
    command:
      - --providers.docker.network=proxy

networks:
  proxy:
    name: proxy

volumes:
  letsencrypt:
    name: letsencrypt
```

設定でいうことは特になし。

これで`docker compose up -d` して、`localhost:8080`に接続した場合、以下の通りのページが表示される。

![dashboard](/assets/traefik_dashboard.png)

この、`HTTP`タブを開くと、以下の通りの画面が表示される

![httptab](/assets/http-tab.png)

これを見ると現時点では、api、dashboard、http to httpsのリダイレクトルーティングしかないことがわかる

### nginxのサービスをたててroutingしてみる

`docker-compose.yml`を以下のように変更する
```yaml
services:
  traefik:
~~~~~~~~~~~~
# 以下を追加
  nginx:
    image: nginx
    networks:
      - proxy
    labels:
      - traefik.enable=true
      - traefik.http.routers.nginx.rule=Host(`nginx.host.name`)
      - traefik.http.services.nginx.loadbalancer.server.port=80
~~~~~~~~~~~~
networks:
```

そして`docker compose up -d`をする
```
~/work/traefik-sample$ sudo docker compose up -d
[+] Running 2/2
 ✔ Container traefik-sample-nginx-1    Started                                                                                                                                                                                                                                                0.3s
 ✔ Container traefik-sample-traefik-1  Running
```

再度ダッシュボードを見ると、`nginx.tosukui.xyz`(今回は自分のホストネーム)がルーティングに加わっていることがわかる
![http-tab-nginx](/assets/http-tab-nginx.png)

また、実際に`https://nginx.host.name`にアクセスするとルーティングされる

これは、traefikがdockerのネットワーク内のserviceを観察し、以下のようにラベルの情報を見て処理しているためである
```
- traefik.enable=true # これがついている場合はtraefikのルーティング対象
- traefik.http.routers.nginx.rule=Host(`nginx.host.name`) # これがついている場合はtraefikから該当のホストネームでルーティングされる
- traefik.http.services.nginx.loadbalancer.server.port=80 # 内部の80番ポートにフォーワーディングする
```

### httpbinサービスを立てる

最終的にこういうコンフィグになる

docker-compose.yml
```yaml
services:
  traefik:
    image: traefik:v3.0
    ports:
      - 80:80
      - 443:443
      - 8080:8080
    networks:
      - proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - letsencrypt:/letsencrypt
      - /var/log:/var/log
      - ./traefik.yml:/etc/traefik/traefik.yml
    command:
      - --providers.docker.network=proxy

  nginx:
    image: nginx
    networks:
      - proxy
    labels:
      - traefik.enable=true
      - traefik.http.routers.nginx.rule=Host(`nginx.your.host`)
      - traefik.http.services.nginx.loadbalancer.server.port=80

  httpbin:
    image: kennethreitz/httpbin
    networks:
      - proxy
    labels:
      - traefik.enable=true
      - traefik.http.routers.httpbin.rule=Host(`httpbin.your.host`)
      - traefik.http.services.httpbin.loadbalancer.server.port=80

networks:
  proxy:
    name: proxy

volumes:
  letsencrypt:
    name: letsencrypt
```


そして、`docker-compose up -d`する

```
~/work/traefik-sample$ sudo docker compose up -d
[+] Running 3/3
 ✔ Container traefik-sample-httpbin-1  Started                                                                                                                                                                                                                                                0.3s
 ✔ Container traefik-sample-traefik-1  Running                                                                                                                                                                                                                                                0.0s
 ✔ Container traefik-sample-nginx-1    Running
```

すると以下のようにルーティングが行われており、`httpbin.your.host`に接続すると接続成功する
![httpbin](/assets/http-tab-httpbin.png)


### まとめ

* Traefik は、現代のコンテナ・マイクロサービスネイティブなリバースプロキシ
* Traefik は、サービスディスカバリによって自動でプロキシが構築されるという特徴がある
* Traefik のコンフィグファイルには、ログ設定、プロキシ設定、ダッシュボード設定などがある

皆さんもTraefikを使ってリバースプロキシや!

