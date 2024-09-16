---
title: nomadのチュートリアルアプリをデプロイ
author: amemiya
pubDatetime: 2024-09-16T20:25:19+09
postSlug: nomad-tutorial
featured: true
draft: false
tags: [自宅サーバー,VPN,Wireguard,自宅クラウド計画,hashicorp,consul,nomad]
ogImage: ""
description: hashicorp nomadのチュートリアル
canonicalURL: https://blog.tosukui.xyz/posts/nomad-tutorial
---

# 概要
この記事ではhashicorp nomadをminipcにインストールし、dev環境で動かすこと目指す。


## なぜkubeではない？
kubernetes環境が壊れて、その際につらいため。そもそものスタックがデカすぎてトラブルシューティングが厳しい。

時代は複雑からシンプルへと移行している

# nomadって？

概ねkubernetesと同じであるが、アプリ間通信はconsul, シークレット管理はvaultがやるので機能が分割されている。

Nomad は、柔軟なスケジューラおよびワークロードオーケストレーターであり、オンプレミスおよびクラウドインフラストラクチャ上で任意のアプリケーションを大規模に展開および管理できるようにします。Nomad の主な機能には以下のものがあります。

- **効率的なリソース使用**: Nomad は、クラスタのクライアントノードにワークロードを効率的に配置することで、利用可能なクラスタリソースを最適化します。
- **自己回復**: Nomad は、タスクが応答を停止した場合に常に監視および検出し、ダウンタイムを最小限に抑えるためにタスクを再スケジュールするための適切なアクションを実行します。
- **ダウンタイムゼロの展開**: Nomad は、ローリング、ブルーグリーン、カナリア展開などの複数の更新戦略をサポートし、ユーザーへのダウンタイムをゼロに抑えるためにアプリケーションを更新します。
- **クロスプラットフォームサポート**: Nomad は、単一のバイナリとして実行され、macOS、Windows、および Linux クライアント上でアプリケーションをオーケストレートできるようにします。
- **統一および宣言的なワークフロー**: Nomad 上のアプリケーションの展開および維持のワークフローは、ワークロードタイプおよび構成、コンポーネント間の通信用のサービス定義、リージョンおよびデータセンターなどのロケーション値などの重要な属性を概説する宣言的なジョブ仕様内に統一されています。



# セットアップ
## nomadのインストール
```bash
sudo apt-get update && \
sudo apt-get install wget gpg coreutils
```

hashicorpのGPGキー追加
```bash
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
```

HashiCorp Linux repository追加
```bash
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
```

nomadインストール
```bash
sudo apt-get update && sudo apt-get install nomad
```

インストールの整合性チェック
```bash
nomad -v
```

## クラスター作成

**※事前にdockerのインストールが必要**

### チュートリアルリポジトリをCloneする

```bash
git clone https://github.com/hashicorp-education/learn-nomad-getting-started.git
cd learn-nomad-getting-started
git checkout -b nomad-getting-started v1.1
```

### nomadを立ち上げる
IPアドレスの部分は、自分はnodeのプライベートIPである192.168.16.10にした
```
sudo nomad agent -dev \
  -bind 0.0.0.0 \
  -network-interface='{{ GetDefaultInterfaces | attr "name" }}'
```

別のターミナルセッションで、クラスターのアドレスを設定

```
export NOMAD_ADDR=http://localhost:4646
```
なお、ここでNICのバインドを`0.0.0.0`にしていない場合はそのIPを指定する

nomadへの接続を確認する
```
nomad node status
```

webuiもある
```url
http://<nomad instanceのip|localhost>:4646/ui
```

# ジョブをデプロイ・アップデート

以下翻訳+要約

> Nomad クラスターをデプロイし、CLI の設定が完了したのであれば、次のステップはアプリケーションのデプロイです。
>
> このチュートリアルでは、サンプルアプリケーションのデプロイと更新を実行します。この過程で、Nomad のジョブ仕様について学びます。
>
> サンプルアプリケーションは Docker コンテナで実行され、データベースとデータベースから読み取る Web フロントエンドで構成されています。パラメータ化されたバッチ ジョブでデータベースを設定し、周期的なバッチ ジョブで追加の短期間のジョブを開始してデータベースにデータを書き込む設定を行います。

> ## ジョブの種類
> Nomad には、サービス、パラメータ化されたバッチ ジョブ、周期的なバッチ ジョブ、その他のシステム ジョブなどの複数のジョブ種類がサポートされています。このチュートリアルでは、サービス ジョブとパラメータ化されたバッチ ジョブ、周期的なバッチ ジョブについて取り上げます。
>
> ### サポートされているジョブ種類
> * **サービス ジョブ**
>   * **長時間稼働するサービス**: 明示的に停止されるまで実行され続けます。
> * **バッチ ジョブ**
>   + **短期間実行するジョブ**: 成功して終了するまで実行され続けます。
> * **化ブロック(parameterized)**
>   + 必須または任意の入力をジョブに受けつけるように設定できます。
>   + `nomad job dispatch` コマンドでジョブをトリガーすることができます。
> * **periodicブロック**
>   + Nomad ジョブを特定の時間に実行するようにスケジュールできます。

## サンプルアプリケーションをreviewする(reviewはnomad用語)
```bash
cd jobs
```

サンプルアプリのredisを起動
```bash
$ nomad job run pytechco-redis.nomad.hcl
==> 2024-09-15T23:41:22+09:00: Monitoring evaluation "3afb9d5e"
    2024-09-15T23:41:22+09:00: Evaluation triggered by job "pytechco-redis"
    2024-09-15T23:41:23+09:00: Evaluation within deployment: "4d56d0b5"
    2024-09-15T23:41:23+09:00: Allocation "14aa957f" created: node "11788a04", group "ptc-redis"
    2024-09-15T23:41:23+09:00: Evaluation status changed: "pending" -> "complete"
==> 2024-09-15T23:41:23+09:00: Evaluation "3afb9d5e" finished with status "complete"
==> 2024-09-15T23:41:23+09:00: Monitoring deployment "4d56d0b5"
  ✓ Deployment "4d56d0b5" successful

    2024-09-15T23:41:38+09:00
    ID          = 4d56d0b5
    Job ID      = pytechco-redis
    Job Version = 0
    Status      = successful
    Description = Deployment completed successfully

    Deployed
    Task Group  Desired  Placed  Healthy  Unhealthy  Progress Deadline
    ptc-redis   1        1       1        0          2024-09-15T23:51:36+09:00

```

サンプルアプリのweb画面をデプロイ
```bash
$ nomad job run pytechco-web.nomad.hcl
==> 2024-09-15T23:43:47+09:00: Monitoring evaluation "8a3d41d9"
    2024-09-15T23:43:47+09:00: Evaluation triggered by job "pytechco-web"
    2024-09-15T23:43:48+09:00: Evaluation within deployment: "9b74cc14"
    2024-09-15T23:43:48+09:00: Allocation "d0998833" created: node "11788a04", group "ptc-web"
    2024-09-15T23:43:48+09:00: Evaluation status changed: "pending" -> "complete"
==> 2024-09-15T23:43:48+09:00: Evaluation "8a3d41d9" finished with status "complete"
==> 2024-09-15T23:43:48+09:00: Monitoring deployment "9b74cc14"
  ✓ Deployment "9b74cc14" successful

    2024-09-15T23:44:03+09:00
    ID          = 9b74cc14
    Job ID      = pytechco-web
    Job Version = 0
    Status      = successful
    Description = Deployment completed successfully

    Deployed
    Task Group  Desired  Placed  Healthy  Unhealthy  Progress Deadline
    ptc-web     1        1       1        0          2024-09-15T23:54:01+09:00
```


web画面にアクセス
自分は192.168.16.10にサーバーがあるのでそこに接続
```
http://192.168.16.10:5000
```


pytecho-setupをセット
```bash
nomad job run pytechco-setup.nomad.hcl
```


pytecho-setupジョブを実行
```
nomad job dispatch -meta budget="200" pytechco-setup
```


employeeジョブを実行
```bash
nomad job run pytechco-employee.nomad.hcl
Job Warnings:
1 warning:

* cron is deprecated and may be removed in a future release. Use crons instead

Job registration successful
Approximate next launch time: 2024-09-15T15:38:27Z (3s from now)
```

employeeジョブの中身でcronの指定があったが3秒に一回とcronの60倍の分解能を持つ最強仕様
```hcl
periodic {
  cron             = "0/3 * * * * * *"
  prohibit_overlap = false
}
```

なお、cronはdeprecatedされるらしく、今後はcronsを使った方が良いらしい

cronsで書く場合は以下の通りになる

```hcl
periodic {
  crons             = ["0/3 * * * * * *"]
  prohibit_overlap = false
}
```

これで一旦nomadのクラスタ作成チュートリアル終了












