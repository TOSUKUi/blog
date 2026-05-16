---
title: GMKtec EVO-X2でRTX PRO 6000 BlackwellをOCuLink接続する
author: TOSUKUi
pubDatetime: 2026-05-16T15:00:00+09:00
postSlug: evo-x2-rtx-pro-6000-blackwell-oculink
featured: true
draft: false
tags:
  [
    GMKtec,
    EVO-X2,
    Strix Halo,
    RTX PRO 6000 Blackwell,
    Ubuntu,
    OCuLink,
    USB4,
    Thunderbolt,
    Resizable BAR,
    vLLM,
  ]
ogImage: ""
description: GMKtec EVO-X2 / Strix Halo に RTX PRO 6000 Blackwell Workstation Edition を外付けして起動させるまでの備忘録。USB4/ThunderboltでCUDA実行時にホストが落ちる、OCuLinkではBIOSで止まる、ReBARを切ると起動する、という流れ。
canonicalURL: https://blog.tosukui.xyz/posts/evo-x2-rtx-pro-6000-blackwell-oculink
---

# 目次

# Pro 6000 blackwell が届いた！

![alt text](/assets/pro-6000-blackwell.webp)

ついに我が家にも Pro 6000 blackwell が届いたので、これを使って推論するぞと思い、

GMKTEC-EVO-x2 に接続 egpu ですることに。

# 結論から

最終的に動いている構成はこれ。

```text
GMKtec EVO-X2
  -> M.2 to OCuLink Adapter
    -> OCuLink Cable
      -> Minisforum DEG2
        -> RTX PRO 6000 Blackwell Workstation Edition
```

最速で Oculink での eGPU 起動方法を確認したい方はこちら。
[oculink で起動する](#oculink-で起動する)

見た目

![oculink](/assets/oculink.webp)

BIOS 側は、少なくとも手元ではこの 2 つをこうしておくと起動する。

- `UMA Frame buffer Size`: `512M`
- `PCIe Resizable BAR support`: `Disabled`

申し訳程度のアフィリンクを貼ります

Minisforum DEG2 (なんか deg1 になってる)

https://www.amazon.co.jp/dp/B0D924WCL4?th=1&linkCode=ll2&tag=blogtosukuixy-22&linkId=f3f94af59d1ddd665bdd4c2ac1ab9057&ref_=as_li_ss_tl

結局今回は oculink 接続だったし、今後 GPU 繋ぐ時は oculink にした方が安定するだろうから、
deg1 買った方がお得かもしれない。

PRO 6000 Blackwell のアフィリンク（これについては悪ふざけ）

https://www.amazon.co.jp/NVIDIA-Blackwell-Max-Q-Workstation-900-5G153-2500-000/dp/B0FTDC9VGF?crid=3AE5HK4A093KF&dib=eyJ2IjoiMSJ9.f68moXF6uVoIygrAOT9u5cYErgR-adot6h2gUQeKzPHzLg02J_wgJq8cHyc2f_opJ7KV33mLjVkSWPwS5cYgEGaHiLr5PaE95QsrZIhMb_CsLgJI1601pwmQMCvSb6H7FGGI6fw0SK60GdbFsWDECpQK5tkMCY2v-J1AA1TWwwaTKgj-aKfLaqTE3LfkW0BwfOGUA0IgEnu1dddQcBfFP97B79SzQAsufxAH75QUwp6TRrMo1lcJC7V6u4Xe46tOnuQDTT3aAAAyHRAwYACVHQ.iqna8bJ0hb7p73ReENzmzYKRgp1C0CnJtqiR1RjuHK8&dib_tag=se&keywords=pro+6000+blackwell&qid=1778925371&sprefix=PRO+6000+Blackwell%2Caps%2C175&sr=8-1&ufe=app_do%3Aamzn1.fos.f851e75d-a860-4774-84a1-525c65264f29&linkCode=ll2&tag=blogtosukuixy-22&linkId=3b8a77e1af419ce96811e192f6f3c804&ref_=as_li_ss_tl

# はじめに

この記事は、GMKtec EVO-X2 に Minisforum DEG2 で RTX PRO 6000 Blackwell を外付けするために、いろいろやった備忘録。

大まかにいうと、最初に USB4 / Thunderbolt 経由での接続を試したところ、GPU の認識はしたが、CUDA の実行時にホストごとハードロックしてフリーズする問題が発生した。調べていくと、この構成ではかなり厳しそうだったので OCuLink に完全移行し、その後も BIOS ロゴすら出ないなど何回か格闘するが、最終的には起動まで持っていけたという話。

ここから先は、そこに至るまでの格闘ログで、備忘録兼、議事録みたいなものとして残しておく。

ゴールデンウィークがこれで潰れ、物理再起動を 20 回くらいやるうちに肋間神経痛みたいな症状が起きた。

# 環境

```text
Host: GMKtec EVO-X2
APU: AMD Ryzen AI Max / Strix Halo
Internal GPU: AMD Radeon 8060S Graphics / gfx1151
GPU: NVIDIA RTX PRO 6000 Blackwell Workstation Edition
GPU Dock: Minisforum DEG2
Driver: NVIDIA 595.58.03 open kernel module
OS: Ubuntu
BIOS: EVO-X2 1.04
```

NVIDIA driver は open kernel module を使っている。

```text
sudo apt install nvidia-driver-595-open
nvidia-smi
```

![nvidia-smi](/assets/nvidia-smi.png)

# USB4 / Thunderbolt で起きたこと

まず DEG2 を USB4 でつなぐ。

![usb4](/assets/usb4-connection.webp)

起動時から刺しておくと不安定なことが多くて、手元ではだいたいこの順にすると認識しやすい。

```text
1. EVO-X2 を eGPU なしで起動
2. ログイン後に DEG2 を ON
3. USB4 ケーブルを挿す
4. PCI rescan
```

PCI rescan はこれ。

```bash
echo 1 | sudo tee /sys/bus/pci/rescan
```

この時点で NVIDIA endpoint は見えて、`nvidia-smi` にも出るし、driver も load されている。

```text
NVRM: loading NVIDIA UNIX Open Kernel Module for x86_64 595.58.03
```

ただ、CUDA で GPU メモリを触った瞬間にホストごと落ちて強制再起動が必要になる。

## 最小再現

vLLM だけの問題にしたくなかったので、Docker 上の PyTorch で最小再現を取っている。

```bash
docker run --rm --gpus all --ipc=host \
  pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime \
  python -c '
import torch
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0))
x = torch.empty((1024, 1024), device="cuda")
torch.cuda.synchronize()
print("small ok")
'
```

観測としては、ここまでは出る。

```text
True
NVIDIA RTX PRO 6000 Blackwell Workstation Edition
```

ただし `small ok` には到達しない。ここでホストがハードロックする。

vLLM でも llama.cpp でも似た落ち方をしていて、いまの感触だと CUDA の初回 device memory allocation 付近が怪しいっぽい。

電力が原因かも、と思って power limit を落としても再現する。

```text
Pwr:Usage/Cap  11W / 150W
```

別ホスト(GMKTec NucBox M6)でも似た落ち方をしたので、EVO-X2 固有の USB4 実装だけ、という感じでもなさそう。

よくよく調べてみると、Thunderbolt 接続は、かなりのハッスルを伴わないと解決できなさそうなので、
Oculink に移行することとした。

Thunderbolt 接続で Blackwell が動かない理由は以下。

## （用語）resizable BAR とは

本格的な理由を書く前に、事前知識として、BAR に関する自分の理解を書いておく。

PCIe デバイスは、CPU から見ると「レジスタ」や「メモリ」に見える領域を BAR (Base Address Register) という枠で持っている。

GPU だと、この BAR の一つ (よく BAR1 と呼ばれるやつ) が「CPU から GPU の VRAM を覗くための窓」になっている。

ReBAR 無効: この窓が小さめ (典型的には 256MiB とか) になっていて、CPU からは VRAM の一部しか直接見えない
ReBAR 有効: その窓をもっと大きくできて、場合によっては VRAM を丸ごと見えるようにする

ここで重要なのは、ReBAR を有効にすると「VRAM のサイズに近い巨大な窓」を PCIe のアドレス空間に用意する必要が出てくる、という点。

RTX PRO 6000 Blackwell は 96GB VRAM を持っている。で、ここが少しややこしいのだが、BAR のサイズはキリのいい 2 の累乗に寄ることが多くて、96GB をそのまま 96GB で開くというより、128GB 級の窓を要求する方向になりがち。

つまり ReBAR を「ちゃんと」やろうとすると、

GPU 用に 128GB くらいの prefetchable MMIO 領域を空ける

みたいな話になってくる。

で、おそらく GMKTEC-EVOX2 はメインの VRAM が 96GB レベルで積めるので、
eGPU に割り当てられる BAR size が BIOS の仕様上そこまで多くないんじゃないかと思っている。

Threadripper のように大量の GPU を接続する前提のリッチな BIOS じゃなければ正攻法では厳しい、ということ。

## Thunderbolt が難しい理由

UThunderbolt / USB4 の eGPU は、普通の PCIe スロットに刺さった GPU と違って、hotplug 用の PCIe bridge の奥にぶら下がる。

ここで何が起きるかというと、GPU が持っている BAR は、bridge の「窓 (window)」を通して CPU 側に見える必要がある。

- bridge の窓が十分に大きいなら、そのまま巨大 BAR でも通る
- 窓が小さい、あるいは多段 bridge で事情が悪いと、OS が再配置 (realloc) を頑張ることになる
  その結果、

- nvidia-smi で見える (列挙と driver load までは通る)
- でも CUDA が本気で device memory を触り始めた瞬間に落ちる

みたいな状態になることがあるっぽい。

このへんは Ubuntu Community Hub の以下の記事が、かなり近い状況を扱っていて参考になった。

https://discourse.ubuntu.com/t/external-gpu-rtx-6000-pro-on-ubuntu-25-10-26-04/77130

記事内でも pci=realloc や pci=hpmmioprefsize=128G のような引数が出てくるし、さらに進むと bridge window を手で調整したり、BAR を resize したり、module の load 順まで制御したり、というレベルの workaround が並ぶ。

自分はここまで頑張りたくないので、この記事を読んだ結果、素直に Oculink 接続で頑張ることにした。

# OCuLink で起動する

EVO-X2 にはネイティブ OCuLink ポートがないので、内部 M.2 スロットを M.2 to OCuLink アダプタで外に出す。

構成はこう。

```text
GMKtec EVO-X2
  -> M.2 to OCuLink Adapter
    -> OCuLink Cable
      -> Minisforum DEG2
        -> RTX PRO 6000 Blackwell Workstation Edition
```

M.2 to OCuLink Adapter は以下を使った

https://www.amazon.co.jp/dp/B0DDXW3XGS?th=1&linkCode=ll2&tag=blogtosukuixy-22&linkId=0b67b40db35b30128f8773f330ce3f16&ref_=as_li_ss_tl

内部 M.2 を GPU に使うので、モデル置き場にしていた SSD は USB4 NVMe エンクロージャに逃がしている。

## OCuLink にしたら BIOS ロゴすら出ない

OCuLink に寄せると素直に動きそう、という期待があったが、最初はもっと低いレイヤで止まっちまった。

OCuLink 接続状態で起動すると、Ubuntu どころか BIOS ロゴも出ない。本体側 HDMI も真っ黒で ping も通らない。

これは、BIOS / UEFI の PCIe 初期化あたりで詰まっていそう、という感じになる。

## 原因は Resizable BAR だった

EVO-X2 の BIOS に入って確認する。

Advanced から GFX Configuration に入ると、通常表示では iGPU Configuration と UMA Frame buffer Size だけが見えている。

![Advanced の GFX Configuration。通常表示では iGPU Configuration と UMA Frame buffer Size だけが見えている。](/assets/bios1.webp)

![GFX Configuration 内の通常表示。UMA Frame buffer Size は 512M にしているが、Resizable BAR の項目はまだ出ていない。](/assets/bios2.webp)

ここで `Alt + F5` を押すと、debug item の表示切り替えが出る。

```text
Show hide items for debug!
```

![Alt + F5 を押すと、Show hide items for debug! が出る。](/assets/bios3.webp)

なんだこれは...たまげたなぁ。

これで隠し項目が出て、`PCIe Resizable BAR support` が現れる。

右側の説明はこう。

```text
AMD Smart Access Memory,
Unlocks dGPU memory for performance
```

要するに Resizable BAR / Smart Access Memory の設定で、この値を `Disabled` にする。

![PCIe Resizable BAR support を Disabled にする。](/assets/bios4.webp)

設定としてはこう。

```text
GFX Configuration
  iGPU Configuration: UMA_SPECIFIED
  UMA Frame buffer Size: 512M
  PCIe Resizable BAR support: Disabled
```

これで OCuLink 接続状態でも起動した。

感触としては、ReBAR 有効だと巨大 BAR を扱う方向になって、EVO-X2 の BIOS 側ではそれに対応しておらず、ハングアップするという認識。

Thunderbolt だと、この状態でも同様にハードロックしたので、おそらく Resizable BAR の割り当てが強制的に走ってしまう模様。

## 起動後の確認

起動後、PCIe ツリーでは RTX PRO 6000 Blackwell が見える。

```text
+-03.0  Advanced Micro Devices, Inc. [AMD] Strix/Strix Halo Dummy Host Bridge
+-03.1-[c5]--+-00.0  NVIDIA Corporation GB202GL [RTX PRO 6000 Blackwell Workstation Edition]
|            \-00.1  NVIDIA Corporation Device 22e8
```

BAR1 はこうなっている。

```bash
nvidia-smi -q | grep -A5 "BAR1 Memory Usage"
```

```text
BAR1 Memory Usage
    Total                                          : 256 MiB
    Used                                           : 2 MiB
    Free                                           : 254 MiB
```

ReBAR が効いていない状態なので BAR1 は 256MiB のまま。

ただ、これは「96GB VRAM が使えない」という意味ではなくて、CPU から GPU VRAM を覗くための窓が小さい、という話になる。

推論で使う分には、まず起動して CUDA で触れることの方が大事そう、ということでいったんこれで進めている。

## 96GB を使う推論も通った

ReBAR を切って BAR1 が 256MiB のままでも、GPU 側の VRAM を実際に食う推論は通った。

手元では、モデルを載せて 90GB 台までメモリ使用量が上がる状態まで持っていけていて、とりあえず「起動したけど薄い確認だけ」ではなく、ちゃんと 96GB を使うところまで行けている。

# まとめ

- USB4 / Thunderbolt は、GPU の認識までは行くが、CUDA 実行でホストがハードロックする
- OCuLink は、最初 BIOS ロゴすら出ないが、`PCIe Resizable BAR support` を `Disabled` にすると起動する
- ReBAR を切った状態でも、96GB を使う推論は通る

なので、EVO-X2 で RTX PRO 6000 Blackwell を外付けするなら、現時点では OCuLink に寄せて ReBAR を切るのが一番早い。
