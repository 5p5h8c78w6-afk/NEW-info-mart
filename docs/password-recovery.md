# 所有者のパスワード再設定（公開前候補）

対象プロジェクト: wgsoxtphhclgdqcomnpd。所有者UIDは実DBで会社作成者・共通マスター更新者と一致を確認済み。

`recover.html` と `recover.js` を既存のPagesへ追加する案。既存アプリ・SQL・RLS・Auth設定は変更しない。v1.8.0とは独立。公開にはユーザーの別途承認が必要。現時点で実メールの送信・実パスワードの変更・本番公開は実施していない。

公開後にユーザー自身が実施する手順:
1. 対象プロジェクトの Authentication → Users → 照合済み所有者 → Send password recovery を実行。
2. 届いたメールのリンクを開かず、長押しでリンクをコピーする。チャットへ送らない。
3. 公式Pagesの `/NEW-info-mart/recover.html` を開き、既存のPublishable keyとリンクを貼り、本人確認を押す。
4. マスクされたアドレスが本人のものか確認してから、新しいパスワードを2回入力し、変更ボタンを押す。
5. パスワード管理へ保存して、既存アプリでログイン。クラウドへのマスター上書きはしない。

メールリンクのtokenをtoken_hashとして固定プロジェクトのAuth /verifyへPOSTする。任意のredirect_toへ移動しない。成功セッションはメモリのみ。Auth /userで既存所有者IDを照合してからPUT /userのpasswordだけを送る。refresh token、秘密鍵、端末内の既存アプリデータは保存しない。通信不明時に自動再送しない。

検証: `node --test tests/recovery.test.cjs`。モック検証と実機・実Auth検証を区別する。メールテンプレートが標準のSupabase確認URL以外（メール追跡URL等）の場合は拒否。メール事前読み込みでリンクが消費される場合も使用不可。その場合は別途対応が必要。

共通マスター6件/2件の退避は別途実施済み。DB全体のバックアップとは異なる。この手順は所有者のパスワード変更だけを承認対象とし、Auth設定・業務データ・SQLの変更を含まない。

公式資料:
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/reference/javascript/auth-verifyotp
- https://supabase.com/docs/reference/javascript/auth-updateuser
