---
title: argocdをingress-nginxでアクセスできるようにする
author: amemiya
pubDatetime: 2024-07-06T10:55:19Z
postSlug: argocd-ingress-nginx
featured: true
draft: false
tags:
  [
    自宅サーバー,
    VPN,
    Wireguard,
    自宅クラウド計画,
    argocd,
    ingress-nginx,
    ingress,
    nginx,
  ]
ogImage: ""
description: argocdをingress nginx経由で接続できるようにする
canonicalURL: https://blog.tosukui.xyz/posts/argocd-ingress-nginx
---

# ArgoCD ingress-nginx 経由でアクセスできるようにする

## ingress の設定

ほぼこちらに載っている: https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/

https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/

今回は、argocd の certificate をそのまま流用できる ssl-passthrough を利用する

### ingress-nginx の`--enable-ssl-passthrough`を`true`にする

ingress-nginx-controller に対する deployment のパッチファイルを作成
`ingress-nginx/deployment-patch.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ingress-nginx-controller
spec:
  template:
    spec:
      containers:
        - args:
            - /nginx-ingress-controller
            - --publish-service=$(POD_NAMESPACE)/ingress-nginx-controller
            - --election-id=ingress-nginx-leader
            - --controller-class=k8s.io/ingress-nginx
            - --ingress-class=nginx
            - --configmap=$(POD_NAMESPACE)/ingress-nginx-controller
            - --validating-webhook=:8443
            - --validating-webhook-certificate=/usr/local/certificates/cert
            - --validating-webhook-key=/usr/local/certificates/key
            - --enable-metrics=false
            - --enable-ssl-passthrough=true
            - --udp-services-configmap=ingress-nginx/udp-services
            - --tcp-services-configmap=ingress-nginx/tcp-services
          name: controller
```

```
kubectl patch deployment nginx-ingress-controller -n ingress-nginx --patch-file ingress-nginx/deployment-patch.yml
```

以下の通りに ingress を設定し、適用する

argocd/ingress.yml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: argocd-server-ingress
  namespace: argocd
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-passthrough: "true"
    # If you encounter a redirect loop or are getting a 307 response code
    # then you need to force the nginx ingress to connect to the backend using HTTPS.
    #
    nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"
spec:
  ingressClassName: nginx
  rules:
    - host: argocd.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: argocd-server
                port:
                  name: https
  tls:
    - hosts:
        - argocd.example.com
      secretName: argocd-server-tls # as expected by argocd-server
```

```bash
kubectl apply -f argocd/ingress.yml
```

## 参考文献

- Argocd official document - Ingress Configuration https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/
