---
title: kubernetesのセットアップ
author: amemiya
pubDatetime: 2023-08-25T21:10:19+09
postSlug: kubernetes-setup
featured: true
draft: false
tags: [自宅サーバー,VPN,Wireguard,自宅クラウド計画,istio,metallb]
ogImage: ""
description: kubernetesのセットアップ方法を書いています。使っている技術スタック istio metallb calico
canonicalURL: https://blog.tosukui.xyz/posts/kubernetes-setup
---

# kubernetesのセットアップ
- [kubernetesのセットアップ](#kubernetesのセットアップ)
  - [インフラ構成](#インフラ構成)
    - [ハードウェア](#ハードウェア)
    - [ネットワーク構成](#ネットワーク構成)
  - [ホストOSの基本設定](#ホストosの基本設定)
    - [hostsの設定](#hostsの設定)
    - [ファイアウォールの設定](#ファイアウォールの設定)
    - [ネットワークモジュール設定](#ネットワークモジュール設定)
    - [スワップ無効化](#スワップ無効化)
    - [containerdインストール](#containerdインストール)
      - [Systemd cgroupドライバを有効化](#systemd-cgroupドライバを有効化)
    - [kubeadmのインストール](#kubeadmのインストール)
    - [クラスターの初期化](#クラスターの初期化)
    - [他のワーカーノードを参加させる](#他のワーカーノードを参加させる)
  - [ネットワーク環境の構築](#ネットワーク環境の構築)
    - [calicoのインストール](#calicoのインストール)
      - [まずtigera-operatorをインストール](#まずtigera-operatorをインストール)
      - [次にcalicoをインストールするための設定ファイルをダウンロードする](#次にcalicoをインストールするための設定ファイルをダウンロードする)
      - [クラスタに適用](#クラスタに適用)
      - [確認する](#確認する)
    - [MetalLB](#metallb)
      - [インストール](#インストール)
      - [公開するIPに応じて中身を編集](#公開するipに応じて中身を編集)
    - [Istioのインストール](#istioのインストール)
      - [istioctlのインストール](#istioctlのインストール)
      - [istioのクラスタへのインストール](#istioのクラスタへのインストール)



## インフラ構成
### ハードウェア
- ゲートウェイ用クラウド1(Debian 11 (bullseye))
  - GCP vm instance 8$/month

- 自宅サーバー3台(いずれもubuntu22.04)
    - worker用
        - <a target="_blank" href="https://www.amazon.co.jp/dp/B0BYNM95ZJ?psc=1&amp;ref=ppx_pop_dt_b_product_details&_encoding=UTF8&tag=tosukui-22&linkCode=ur2&linkId=6a2fc535854cf2c3d23f8fb3452e8e5b&camp=247&creative=1211">Beelink Mini PC、AMD Ryzen7 5800H nvme 500GB 16GB RAM</a> x 2
            - 買った当初は45000円でスペックに対して意味不明な安さをしていた
            - まだCPU使用率あまりないがぶん回した時に夜寝られるかは心配なポイント

    - control-plane用
        - <a target="_blank" href="https://amzn.to/3KxxyTl">NIPOGI Intel N95 mini pc</a> x 1
            - アフィリンクを貼った手前だが以下の理由であまりお勧めしない
            - 有線接続系のドライバがrealtek r8168なのだが、セットアップで苦労する
            - 結構青光りするので夜寝る時に気になるかも

### ネットワーク構成
- ゲートウェイ用クラウド -> worker1へ10.0.0.3でwireguard接続
- クラスタは3台構成
  - control-plane1
    - 192.168.5.12
  - worker1
    - 192.168.5.10 enp1s0 LAN
    - 10.0.0.3 wg0 # wireguard
  - worker2
    - 192.168.5.11 enp1s0 LAN

## ホストOSの基本設定
### hostsの設定
各ノードで設定しておく
```sh
192.168.5.12 control-plane1 # コントロールプレーン
192.168.5.11 worker2
192.168.5.10 worker1
```

### ファイアウォールの設定
性善説

### ネットワークモジュール設定
次のコマンドを実行して、カーネル モジュール \overlay\ および \br_netfilter\ を有効にします。

```sh
modprobe overlay
modprobe br_netfilter
```
```sh
cat <<EOF | tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
```

```sh
cat <<EOF | tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
```

永続化
```sh
sysctl --system
```
### スワップ無効化
```sh
sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab
```
```sh
swapoff -a
free -m #確認
```

ただ、上記の設定をしてもrebootした時に復活することがある。

その場合は以下を参照するといい.

https://qiita.com/zembutsu/items/2d8a7f5caa4885d08591


### containerdインストール
aptで入れるのが丸い
```sh
apt install ca-certificates curl gnupg
```
```sh
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
```
```sh
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```sh
apt update
apt install containerd.io
```
参考: https://docs.docker.com/engine/install/ubuntu/

#### Systemd cgroupドライバを有効化

ubuntu 22.04ではcontainerdのランタイムでsystemd cgroupドライバを有効化することを推奨されている

インストールが完了したら、次のコマンドを実行して containerd サービスを停止。
```sh
systemctl stop containerd
```

containerdのコンフィグファイルを生成、編集
```sh
containerd config default > /etc/containerd/config.toml
vim /etc/containerd/config.toml
```

以下の`SystemdCgroup = false`を`true`にする。出現箇所はcontainerd v1.7.3時点で1箇所
```diff
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
  ...
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
-    SystemdCgroup = false
+    SystemdCgroup = true
```

修正完了したら起動
```sh
systemctl start containerd
```

確認し、activeならおk
```sh
systemctl status containerd
```
### kubeadmのインストール
```sh
apt install apt-transport-https ca-certificates curl -y
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
```
kubernetesのパッケージ群をインストールし、バージョン固定
```sh
apt update
apt install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl
```

### クラスターの初期化

kubeadm initコマンドを利用し、control-plane1上でkubernetesクラスタを初期化する
```sh
 kubeadm init --service-cidr=10.2.0.0/16  --pod-network-cidr=10.1.0.0/16 --cri-socket=unix:///run/containerd/containerd.sock --apiserver-advertise-address=192.168.5.12
```

https://www.infraexpert.com/study/ip5.html によるとprivate ipは10系が幅を取りやすいので、pod, serviceのネットワークは10.1・10.2系の/16とした。

うまくいくと他のノードがクラスタにjoinするためのコマンドが表示される。

```bash
kubeadm join 192.168.5.12:6443 --token <token> \
        --discovery-token-ca-cert-hash sha256:<hash>
```

### 他のワーカーノードを参加させる

worker1, worker2ノードで実行する。
```sh
root@worker1 $ kubeadm join 192.168.5.12:6443 --token <token> \
        --discovery-token-ca-cert-hash sha256:<hash>
root@worker2 $ kubeadm join 192.168.5.12:6443 --token <token> \
        --discovery-token-ca-cert-hash sha256:<hash>
```

## ネットワーク環境の構築

ここからユーザー権限に戻る。

以下のユーザーレベルでもクラスタに繋げるようにするコマンドを実行する。

```bash
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

### calicoのインストール
ここからはどこでもいいのでkubectlが叩けるところで行う。
#### まずtigera-operatorをインストール
```sh
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/tigera-operator.yaml
```

#### 次にcalicoをインストールするための設定ファイルをダウンロードする
```sh
curl https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/custom-resources.yaml -O
```

vimかなんかで弄る
```sh
vim custom-resources.yaml
```
以下のようにする

cidrは`kubeadm init`で設定した`pod-cidr`の値を設定

nodeAddressAutodetectionV4はほっといてもよしなにやってくれるが、一応こっちでLAN networkを指定しておく
```yaml
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  # Configures Calico networking.
  calicoNetwork:
    # Note: The ipPools section cannot be modified post-install.
    ipPools:
    - blockSize: 26
      cidr: 10.1.0.0/16
      encapsulation: VXLANCrossSubnet
      natOutgoing: Enabled
      nodeSelector: all()
    nodeAddressAutodetectionV4:
      cidrs:
        - "192.168.5.0/24"
---

# This section configures the Calico API server.
# For more information, see: https://projectcalico.docs.tigera.io/master/reference/installation/api#operator.tigera.io/v1.APIServer
apiVersion: operator.tigera.io/v1
kind: APIServer
metadata:
  name: default
spec: {}

```

#### クラスタに適用
```sh
kubectl create -f custom-resources.yaml
```

#### 確認する
```sh
watch kubectl get pods -n calico-system
```
こういうのが出てたらおk
```sh
NAMESPACE     NAME                READY   STATUS                  RESTARTS         AGE
kube-system   calico-node-txngh   1/1     Running                   0              54s
Policy	IPAM	CNI	Overlay	Routing	Datastore
```


### MetalLB
#### インストール
このあとistioでメッシュ構築をしますが、そのLoadBalancerを外部公開するために必要

```sh
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.13.10/config/manifests/metallb-native.yaml
```

#### 公開するIPに応じて中身を編集
adressesをLoadBalancerで外部公開するためのIPレンジにする

自分の場合は10.0.0.3を外部との接続に使いたい

```yaml
kubectl apply -n metallb-system -f - <<EOF
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: default-pool
  namespace: metallb-system
spec:
  addresses:
  - 10.0.0.3/32
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: default-advertisement
  namespace: metallb-system
EOF
```

### Istioのインストール
#### istioctlのインストール
```sh
curl -L https://istio.io/downloadIstio | sh -
```

#### istioのクラスタへのインストール
```sh
istioctl install --set profile=demo -y
✔ Istio core installed
✔ Istiod installed
✔ Egress gateways installed
✔ Ingress gateways installed
✔ Installation complete
```
```sh
kubectl label namespace default istio-injection=enabled
namespace/default labeled
```


これで一通りの設定が完了


