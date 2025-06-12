---
title: helmを使いながらのkubernetesのセットアップ
author: amemiya
pubDatetime: 2024-04-20T16:26:19+09
postSlug: re-kubernetes-setup
featured: true
draft: false
tags: [自宅サーバー, VPN, Wireguard, 自宅クラウド計画, istio, metallb, helm]
ogImage: ""
description: kubernetesのセットアップ方法を書いています。使っている技術スタック istio metallb calico helm
canonicalURL: https://blog.tosukui.xyz/posts/re-kubernetes-setup
---

# kubernetes のセットアップ

- [kubernetes のセットアップ](#kubernetesのセットアップ)
  - [インフラ構成](#インフラ構成)
    - [ハードウェア](#ハードウェア)
    - [ネットワーク構成](#ネットワーク構成)
  - [ホスト OS の基本設定](#ホストosの基本設定)
    - [hosts の設定](#hostsの設定)
    - [ファイアウォールの設定](#ファイアウォールの設定)
    - [ネットワークモジュール設定](#ネットワークモジュール設定)
    - [スワップ無効化](#スワップ無効化)
    - [containerd インストール](#containerdインストール)
      - [Systemd cgroup ドライバを有効化](#systemd-cgroupドライバを有効化)
    - [kubeadm のインストール](#kubeadmのインストール)
    - [クラスターの初期化](#クラスターの初期化)
    - [他のワーカーノードを参加させる](#他のワーカーノードを参加させる)
  - [ネットワーク環境の構築](#ネットワーク環境の構築)
    - [MetalLB](#metallb)
      - [helm 用に values を作成](#helm用にvaluesを作成)
      - [helm インストール](#helmインストール)
      - [公開する IP に応じて metallb/configrations.yml の中身を編集](#公開するipに応じてmetallbconfigrationsymlの中身を編集)
    - [calico のインストール](#calicoのインストール)
      - [helm の repository add](#helmのrepository-add)
      - [calico をインストールするための設定ファイルをダウンロード](#calicoをインストールするための設定ファイルをダウンロード)
      - [クラスタに適用](#クラスタに適用)
      - [helm install](#helm-install)
      - [確認する](#確認する)
    - [ingress-nginx のインストール](#ingress-nginxのインストール)
      - [helm install](#helm-install-1)

## インフラ構成

### ハードウェア

- ゲートウェイ用クラウド 1(Debian 11 (bullseye))

  - GCP vm instance 8$/month

- 自宅サーバー 3 台(いずれも ubuntu22.04)

  - worker 用

    - <a target="_blank" href="https://www.amazon.co.jp/dp/B0BYNM95ZJ?psc=1&amp;ref=ppx_pop_dt_b_product_details&_encoding=UTF8&tag=tosukui-22&linkCode=ur2&linkId=6a2fc535854cf2c3d23f8fb3452e8e5b&camp=247&creative=1211">Beelink Mini PC、AMD Ryzen7 5800H nvme 500GB 16GB RAM</a> x 2
      - 買った当初は 45000 円でスペックに対して意味不明な安さをしていた
      - まだ CPU 使用率あまりないがぶん回した時に夜寝られるかは心配なポイント

  - control-plane 用
    - <a target="_blank" href="https://amzn.to/3KxxyTl">NIPOGI Intel N95 mini pc</a> x 1
      - アフィリンクを貼った手前だが以下の理由であまりお勧めしない
      - 有線接続系のドライバが realtek r8168 なのだが、セットアップで苦労する
      - 結構青光りするので夜寝る時に気になるかも

### ネットワーク構成

- ゲートウェイ用クラウド -> worker1 へ 10.0.0.3 で wireguard 接続
- クラスタは 3 台構成
  - control-plane1
    - 192.168.5.12
  - worker1
    - 192.168.5.10 enp1s0 LAN
    - 10.0.0.3 wg0 # wireguard
  - worker2
    - 192.168.5.11 enp1s0 LAN

## ホスト OS の基本設定

### hosts の設定

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

ただ、上記の設定をしても reboot した時に復活することがある。

その場合は以下の systemd コマンドでスワップのサービスをマスクする

`dev-swap.swap`の名前は適宜`systemctl --type swap`にて確認可能

```
sudo systemctl mask "dev-swap.swap"
```

quote: https://qiita.com/zembutsu/items/2d8a7f5caa4885d08591

### containerd インストール

apt で入れるのが丸い

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

https://docs.docker.com/engine/install/ubuntu/

#### Systemd cgroup ドライバを有効化

ubuntu 22.04 では containerd のランタイムで systemd cgroup ドライバを有効化することを推奨されている

インストールが完了したら、次のコマンドを実行して containerd サービスを停止。

```sh
systemctl stop containerd
```

containerd のコンフィグファイルを生成、編集

```sh
containerd config default > /etc/containerd/config.toml
vim /etc/containerd/config.toml
```

以下の`SystemdCgroup = false`を`true`にする。出現箇所は containerd v1.7.3 時点で 1 箇所

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

確認し、active ならお k

```sh
systemctl status containerd
```

### kubeadm のインストール

```sh
apt install apt-transport-https ca-certificates curl -y
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
```

kubernetes のパッケージ群をインストールし、バージョン固定

```sh
apt update
apt install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl
```

### クラスターの初期化

kubeadm init コマンドを利用し、control-plane1 上で kubernetes クラスタを初期化する

```sh
 kubeadm init --service-cidr=10.2.0.0/16  --pod-network-cidr=10.1.0.0/16 --cri-socket=unix:///run/containerd/containerd.sock --apiserver-advertise-address=192.168.5.12
```

https://www.infraexpert.com/study/ip5.html によると private ip は 10 系が幅を取りやすいので、pod, service のネットワークは 10.1・10.2 系の/16 とした。

https://www.infraexpert.com/study/ip5.html

うまくいくと他のノードがクラスタに join するためのコマンドが表示される。

```bash
kubeadm join 192.168.5.12:6443 --token <token> \
        --discovery-token-ca-cert-hash sha256:<hash>
```

### 他のワーカーノードを参加させる

worker1, worker2 ノードで実行する。

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

### MetalLB

#### helm 用に values を作成

ingress-nginx による LoadBalancer を外部公開するために必要

frr ではなく native モードでインストールしたいので`metallb/values.yml`を以下の通りに作成

```yaml
speaker:
  frr:
    enabled: false
```

#### helm インストール

```sh
helm repo add metallb https://metallb.github.io/metallb
helm install metallb metallb/metallb -f metallb/values.yml -n metallb-system
```

#### 公開する IP に応じて metallb/configrations.yml の中身を編集

adresses を LoadBalancer で外部公開するための IP レンジにする

自分の場合は 10.0.0.3 を外部との接続に使いたい

```yaml:configrations.yaml
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

`metaldb/configrations.yaml`を適用

```
kubectl apply -f metallb/configrations.yml
```

### calico のインストール

#### helm の repository add

```sh
helm repo add projectcalico https://docs.tigera.io/calico/charts
```

#### calico をインストールするための設定ファイルをダウンロード

```sh
curl https://raw.githubusercontent.com/projectcalico/calico/v3.27.3/manifests/custom-resources.yaml -O
```

vim かなんかで弄る

```sh
vim custom-resources.yaml
```

以下のようにする

cidr は`kubeadm init`で設定した`pod-cidr`の値を設定

nodeAddressAutodetectionV4 はほっといてもよしなにやってくれるが、一応こっちで LAN network を指定しておく

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

#### helm install

```sh
helm install calico projectcalico/tigera-operator --version v3.27.3 --namespace tigera-operator
```

#### 確認する

```sh
watch kubectl get pods -n calico-system
```

こういうのが出てたらお k

```sh
NAMESPACE     NAME                READY   STATUS                  RESTARTS         AGE
kube-system   calico-node-txngh   1/1     Running                   0              54s
Policy	IPAM	CNI	Overlay	Routing	Datastore
```

### ingress-nginx のインストール

#### helm install

```shell
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```
