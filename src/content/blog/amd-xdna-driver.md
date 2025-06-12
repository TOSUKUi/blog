---
title: strix haloでnpuドライバを入れて動かす
author: amemiya
pubDatetime: 2025-06-02T10:00:00Z
postSlug: strix-halo-install-xdna-driver
featured: true
draft: false
tags:
  - ryzenai
  - amd
  - amdgpu
  - gpu
  - xdna
  - npu
  - bios
ogImage: ""
description: Strix Haloにおけるnpuを利用したい
canonicalURL: https://blog.tosukui.xyz/posts/strix-halo-install-xdna-driver
---

# 事前準備

- strix halo 搭載済み APU を用意
- linux kernel 6.11 以降
  - 筆者は ubuntu24.04 で dist-upgrade したらカーネルが 6.11 になった

# 手順

ほとんど公式リポジトリに書いてある README.md をなぞる

## 公式リポジトリをクローン

https://github.com/amd/xdna-driver

```bash
git clone https://github.com/amd/xdna-driver
cd xdna-driver
# dependenciesもまとめてクローンしておく
git submodule update --init --recursive
```

## ビルド&インストール

### prerequisite をインストールしておく

```bash
#requires root permissions to run the script
sudo su
cd クローン先のディレクトリ
./tools/amdxdna_deps.sh
# exit from root
exit
```

### xrt をインストール

このとき、pyenv とかその他で python に指定しているとコケる場合があるので、システムの python を指定しておく

筆者は mise で python を指定していたがコケたので`mise use python@system`で乗り越えた

```bash
cd クローン先のディレクトリ/xrt/build
./build.sh -npu -opt # pythonが別のインタプリタを向いてたりするとビルド後テストがコケる。もし一回コケたらpythonがシステムを向くよう環境を整えてから、./build.sh -clean でビルド環境をクリアしてから再度叩く
# ubuntuのバージョンとかに依存。devをインストールしないと後のテストが通らない(readmeはbase.debをインストールしているので罠)
sudo apt reinstall ./Release/xrt_202520.2.20.0_24.04-amd64-base-dev.deb
```

### xdna-driver をインストール

```bash
cd クローン先のディレクトリ/build
# Start XDNA driver release build
./build.sh -release

# Create DEB package for existed release or debug build.
./build.sh -package
# OSのバージョンに依存
sudo apt reinstall ./Release/xrt_plugin.2.19.0_ubuntu22.04-x86_64-amdxdna.deb
```

### テスト

```
source
./build.sh -example
....
[100%] Built target runlist_noop_test

real    0m1.027s
user    0m0.874s
sys     0m0.152s
```

テストが通ったので勝ち

```
amd-ai-worker1:~/work/xdna-driver/build$ ./example_build/example_noop_test ../tools/bins/1502_00/validate.xclbin
Host test code start...
Host test code is creating device object...
Host test code is loading xclbin object...
Host test code is creating kernel object...
Host test code kernel name: DPU_PDI_0
Host code is registering xclbin to the device...
Host code is creating hw_context...
Host test code is creating kernel object...
Host test code allocate buffer objects...
Host test code sync buffer objects to device...
Host test code iterations (~10 seconds): 70000
Host test microseconds: 4028239
Host test average latency: 57 us/iter
TEST PASSED!
```

なお、linux では今の所 npu の使い道はないのでこれからの開発に乞うご期待
