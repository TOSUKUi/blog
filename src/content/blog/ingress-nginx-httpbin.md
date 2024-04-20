---
title: ingress-nginxでhttpbinサーバーを公開する
author: amemiya
pubDatetime: 2024-04-20T17:10:19+09
postSlug: kubernetes-setup
featured: true
draft: false
tags: [自宅サーバー,VPN,Wireguard,自宅クラウド計画,istio,metallb,ingress-nginx,httpbin]
ogImage: ""
description: kubernetesのingress-nginxを使ってhttpbinサーバーを外部公開する方法
canonicalURL: https://blog.tosukui.xyz/posts/ingress-nginx-httpbin
---

# kubernetesのingress-nginxを使ってhttpbinを外部公開する
- [kubernetesのingress-nginxを使ってhttpbinを外部公開する](#kubernetesのingress-nginxを使ってhttpbinを外部公開する)
  - [kubernetes自体の構成については以下を参照](#kubernetes自体の構成については以下を参照)
  - [httpbinサービスのmanifest](#httpbinサービスのmanifest)
    - [deployment](#deployment)
    - [ingress(ingress nginx用)](#ingressingress-nginx用)
    - [service account](#service-account)
    - [service](#service)
    - [確認](#確認)



## kubernetes自体の構成については以下を参照
https://blog.tosukui.xyz/posts/re-kubernetes-setup

## httpbinサービスのmanifest
### deployment
```yaml:deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin
spec:
  replicas: 1
  selector:
    matchLabels:
      app: httpbin
      version: v1
  template:
    metadata:
      labels:
        app: httpbin
        version: v1
    spec:
      serviceAccountName: httpbin
      containers:
      - image: docker.io/kennethreitz/httpbin
        name: httpbin
        ports:
        - containerPort: 80
```

### ingress(ingress nginx用)
```yaml:ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ingress-httpbin
spec:
  rules:
  - host: httpbin.hogehoge.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: httpbin
            port:
              number: 80
  ingressClassName: nginx
```

### service account
```yaml:service-account.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: httpbin
```

### service
```yaml:service.yaml
apiVersion: v1
kind: Service
metadata:
  name: httpbin
  labels:
    app: httpbin
    service: httpbin
spec:
  ports:
  - name: http
    port: 8000
    targetPort: 80
  selector:
    app: httpbin
```

##　クラスタに適用する
上記を`httpbin`ディレクトリに入れて、以下のコマンドで適用
```shell
kubectl apply -f httpbin -n httpbin
```

### 確認
```shell
kubectl get pod httpbin -n httpbin
```


ブラウザで`httpbin.hogehoge.com`を確認する




