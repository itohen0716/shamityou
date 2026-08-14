# キャッシュ更新対策 Ver.1

GitHubリポジトリのルートにある次の3ファイルを上書きしてください。

- service-worker.js
- home.js
- setup.js

## 変更内容

1. Service Workerのキャッシュ名を新バージョンへ変更
2. 新SWのactivate時に旧 `shian-shamisen-*` キャッシュを全削除
3. HTML / JS / CSS / JSON は Network First
4. 上記コード類は `cache: "no-store"` でブラウザHTTPキャッシュも迂回
5. 音源はCache Firstだが、SWバージョン更新時には旧キャッシュごと削除
6. `updateViaCache: "none"` でservice-worker.js更新時にHTTPキャッシュを使わない
7. ページ読込時に `registration.update()` を実行
8. 新SWが待機した場合は `skipWaiting()` で即時切替
9. controllerchange後に一度だけ自動再読込

## 重要

すでに古いService Workerに強く捕まっているスマホは、
この新仕様へ移行する初回だけ、サイトデータ削除またはPWA再インストールが必要な場合があります。
一度新仕様へ移行すれば、以後の更新はかなり反映されやすくなります。

今後リリース時には `CACHE_NAME` の末尾を更新してください。
例:
`shian-shamisen-v4.1-r13-20260820`
