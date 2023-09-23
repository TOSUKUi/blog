---
title: Kubernetes上のminecraftのセットアップ
author: amemiya
pubDatetime: 2023-09-23T19:30:19+09
postSlug: minecraft-on-kubernetes
featured: true
draft: false
tags: [minecraft,kubernetes,istio,persistent-volume,persistent-volume-claim]
ogImage: ""
description:  minecraftのkubernetes上でのセットアップ方k方法を書いています。istio persistent volume , persistent volume claim
canonicalURL: https://blog.tosukui.xyz/posts/minecraft-on-kubernetes
---

# インフラ構成の概要
- minecraftはtcp 25566で受け付ける
- 1ノードで完結
  - ノード構成
    - OS: ubuntu22.04
    - memory: 32GBメモリ
    - cpu: 5800h
  - ネットワーク構成
    - pod cidr: `10.1.0.0/16`
    - service cidr: `10.2.0.0/16`
    - nodes cidr: `192.168.5.0/24`
- /var/nfs/kube/minecraftをnfsとしてpersistent volume化
- コンテナは以下のイメージを使う
  - https://hub.docker.com/r/itzg/minecraft-server
- 答え早見
  - https://github.com/TOSUKUi/kube-manifests/tree/main/minecraft
- istioのインストールとかはこっちの記事
  - https://blog.tosukui.xyz/posts/kubernetes-setup/

# nfsセットアップ
## nfs server clientのインストール
```bash
sudo apt update
sudo apt install nfs-kernel-server nfs-common
```

## nfs でexportするディレクトリを設定
```
sudo vim /etc/exports
```
以下の変更を適用

`/var/nfs/kube`がexportされる
pods service nodesのcidrをすべて設定したのはとりあえずという感じ
```diff
# /etc/exports: the access control list for filesystems which may be exported
#               to NFS clients.  See exports(5).
~~~~~
#
+ /var/nfs/kube 10.1.0.0/16(rw,sync,no_subtree_check) 10.2.0.0/16(rw,sync,no_subtree_check) 192.168.5.0/24(rw,sync,no_subtree_check)
```

これで`/var/nfs/kube`をnfsマウントできる準備が整った

# kubernetesの設定
## persistent volumes周りの設定
`/var/nfs/kube/minecraft`をターゲットにしてpvを作成

pv.yaml
```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: minecraft-pv
  namespace: minecraft
spec:
  capacity:
    storage: 120Gi
  accessModes:
    - ReadWriteMany
  nfs:
    server: worker2
    path: /var/nfs/kube/minecraft
```
そのpvをターゲットにしたpvcを作成

pvc.yaml
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: minecraft-pvc
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 120Gi
  storageClassName: ""
  volumeMode: Filesystem
  volumeName: minecraft-pv
```

pvを500Giとかにして、pvcを100GBに設定して、`/var/nfs/kube/`を、ターゲットにして、
複数のpvcからアクセスできないかも考えたが、1つのpvは1つのpvcに占有されるので無理だった

## deploymentの設定

難易度`normal`、メモリ制限4GB、ボリュームは`minecraft-pvc`を/dataにマウントする設定
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: minecraft
spec:
  replicas: 1
  selector:
    matchLabels:
      app: minecraft
      version: v1
  template:
    metadata:
      labels:
        app: minecraft
        version: v1
    spec:
      serviceAccountName: minecraft
      containers:
      - image: itzg/minecraft-server
        name: minecraft
        ports:
        - containerPort: 25565
        env:
        - name: EULA
          value: "TRUE"
        - name: INIT_MEMORY
          value: "1G"
        - name: MAX_MEMORY
          value: "4G"
        - name: DIFFICULTY
          value: "normal"
        volumeMounts:
        - mountPath: "/data"
          name: world
      volumes:
      - name: world
        persistentVolumeClaim:
          claimName: minecraft-pvc
```




## ネットワーク周りの設定
port 25566で受け付けたい。25565ではないのはなんとなくセキュアな気がするから。

まずistioでport25566を受付可能な状態にするため、
以下のファイルを作成

UDPは開ける意味がほぼないので開けていない
istio-extra-ports.yaml
```yaml
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
metadata:
  name: istio-with-extra-ports
spec:
  profile: demo
  components:
    ingressGateways:
      - namespace: istio-system
        name: istio-ingressgateway
        enabled: true
        k8s:
          service:
            ports:
              - port: 15021
                targetPort: 15021
                name: status-port
                protocol: TCP
              - port: 80
                targetPort: 8080
                name: http2
                protocol: TCP
              - port: 443
                targetPort: 8443
                name: https
                protocol: TCP
              - port: 15012
                targetPort: 15012
                name: tcp-istiod
                protocol: TCP
              - port: 15443
                targetPort: 15443
                name: tls
                protocol: TCP
              - port: 25566
                targetPort: 25566
                name: tcp-minecraft
                protocol: TCP
```

```bash
istioctl install -f istio-extra-ports.yaml
```

これでport 25566がtcpで受付できるようになった

quote: https://learncloudnative.com/blog/2022-08-01-istio-gateway


### istio gatewayでport 25566をminecraftに流す
```yaml
apiVersion: networking.istio.io/v1alpha3
kind: Gateway
metadata:
  name: minecraft-gateway
spec:
  selector:
    istio: ingressgateway
  servers:
  - port:
      number: 25566
      name: tcp
      protocol: TCP
    hosts:
    - "*"
---
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: minecraft
spec:
  hosts:
  - "*"
  gateways:
  - minecraft-gateway
  tcp:
  - match:
    - port: 25566
    route:
    - destination:
        host: minecraft
        port:
          number: 25565
```

service.yaml
```yaml
apiVersion: v1
kind: Service
metadata:
  name: minecraft
  labels:
    app: minecraft
    service: minecraft
spec:
  ports:
  - name: minecraft
    protocol: TCP
    port: 25565
    targetPort: 25565
  selector:
    app: minecraft
```

これで25566をminecraftのpodにに流すネットワーク設定が完成した

## 実際に動かす
上記のmanifestが入ったディレクトリをapplyするだけ
```
kubectl create namespace minecraft
kubectl apply -f minecraft -n minecraft
```

## 懸案事項
実はこのあとmod serverを動かしたのだが、DiskI/Oが重くなるとnfsでは捌ききれないようでラグが頻発した。

そういった場合は`local-storage`によるボリュームを作成すると解決する。

ただ、それでもコンテナとボリュームは分離したいので、今後はパフォーマンスが高いと言われるiscsiを試してみる予定





