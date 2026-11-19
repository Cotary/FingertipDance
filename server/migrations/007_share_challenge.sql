-- 007_share_challenge.sql — 分享挑战：服务端持有挑战，胜负由服务端判定
--
-- ## 为什么要这张表
--
-- 在此之前，「分享挑战」的对手成绩完全靠**分享链接里的 query** 传递
-- （`?l=47&undos=0&uid=88214`），客户端自己比一下 `myUndos <= fromUndos` 就宣布输赢。
-- 这有三个问题：
--
-- 1. **可以伪造** —— 好友把 URL 里的 `undos=0` 一改，服务端不知道，
--    客户端就判「挑战成功」。胜负是一个能被链接参数决定的量，
--    那它就不是成绩，只是一句话。
-- 2. **发起人可以事后否认** —— 服务端没有任何记录说明「88214 确实
--    在第 47 关拿到过 0 次重来」，一切以 URL 为准。
-- 3. **链路断了没法追** —— 埋点只知道「有人点了分享」，不知道
--    「这条分享后来被谁挑战了、结果如何」。
--
-- 这张表把「发起人当时到底什么成绩」固定在服务端：
-- 分享时写入一行，好友打开只拿到一个 **token**，
-- 结算时服务端按 token 取出真正的对手成绩来判胜负。
--
-- ## 为什么 token 是字符串而不是自增 id
--
-- token 会出现在分享链接里。自增 id 可枚举（`?c=1`、`?c=2`…），
-- 等于把「全部挑战」摊开给人翻。用随机串，猜不到就别想遍历。
--
-- ## 为什么允许 `undos = -1`
--
-- 「邀请好友来玩」这种分享**不宣称成绩**（见客户端 openSharePanel 的 null 分支）。
-- 用一个哨兵值 -1 表示「这次分享没有对手成绩」，
-- 结算时不比输赢，只报「你已通过 N 关」。
-- 不能用 0 代替 —— 0 次重来是**最好**的成绩（三星），
-- 语义完全相反，会把邀请变成一次「我零重来通关」的挑战。
--
-- ## 为什么 old 表要 ON CONFLICT 容忍
--
-- 迁移是每次启动都跑一遍的（见 core/migrate.go：不记已执行版本，
-- 逐条 Exec）。所以 DDL 必须全部幂等。

CREATE TABLE IF NOT EXISTS challenges (
  -- 挑战 token：分享链接里的 `c=` 参数。随机串，不可枚举。
  token      VARCHAR(32)  PRIMARY KEY,
  -- 发起人 uid。0 表示匿名（理论上不会出现，登录后才谈得上分享成绩）。
  from_uid   BIGINT       NOT NULL DEFAULT 0,
  -- 被挑战的关号（cover 模式的 1..1000）
  level_idx  INTEGER      NOT NULL,
  -- 发起人的重来次数。**-1 = 不带成绩**（纯邀请，结算不比输赢）。
  from_undos INTEGER      NOT NULL,
  -- 发起人当时的昵称（快照）。
  --
  -- 为什么不 join users 现取：昵称随时会改，而这条挑战是**当时**发出去的。
  -- 好友看到的应该是「分享那一刻的署名」，不是发起人现在的名字。
  from_name  VARCHAR(64)  NOT NULL DEFAULT '',
  created_at TIMESTAMP    NOT NULL
);

-- 结算时按 token 查（主键已覆盖）；这条索引是给「同一人重复分享同一关」的复用查询用
CREATE INDEX IF NOT EXISTS idx_challenges_reuse
  ON challenges (from_uid, level_idx, from_undos);

-- 挑战结果：谁接了谁的挑战、结果如何。
--
-- 与 `challenges` 分开两张表，因为它们是**一对多**：
-- 一条分享可以发给很多人，被挑战多次。放在一张表里的话
-- 「谁挑战过」和「我发起的是什么」会互相覆盖。
CREATE TABLE IF NOT EXISTS challenge_results (
  id          BIGSERIAL   PRIMARY KEY,
  -- 被挑战的那条分享
  token       VARCHAR(32) NOT NULL,
  -- 挑战者
  uid         BIGINT      NOT NULL,
  -- 挑战者的重来次数
  my_undos    INTEGER     NOT NULL,
  -- 服务端判定的胜负（true = 挑战者赢）。
  -- **这一列是判定结果**，不是客户端报上来的 —— 客户端说自己赢了不算数。
  win         BOOLEAN     NOT NULL,
  -- 判定时对手的实际成绩（发起人 undos 快照，便于事后核对）
  rival_undos INTEGER     NOT NULL,
  created_at  TIMESTAMP   NOT NULL
);

-- 同一人对同一条挑战重复结算（重试 / 反复刷）不要重复计数，
-- 但也不能挡住「我要再挑战一次」——所以不加唯一约束，
-- 由 `ORDER BY id DESC LIMIT 1` 取最后一次作为展示值。
CREATE INDEX IF NOT EXISTS idx_challenge_results_token
  ON challenge_results (token, uid);

CREATE INDEX IF NOT EXISTS idx_challenge_results_uid
  ON challenge_results (uid);
