package core

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Migrate 执行 migrations 目录下的所有 .sql 文件（按文件名排序）。
//
// ## 目录怎么定位
//
// `dir` 为空时，**从可执行文件位置推导**，而不是依赖进程工作目录。
//
// 旧实现直接用相对路径 `"migrations"`，结果：
//   - `cd server && go run ./cmd/http` → 能找到
//   - 从仓库根目录 `go run ./server/cmd/http` → 找不到，直接启动失败
//   - 打成二进制丢到 `/usr/local/bin` → 同样找不到
//
// 也就是说这个服务**必须**在 `server/` 目录下启动才能起来 ——
// 部署脚本、容器 entrypoint、systemd unit 都要为它特殊处理。
//
// 现在按优先级找：
//  1. 环境变量 `MIGRATIONS_DIR`（显式指定）
//  2. 可执行文件所在目录的 `../migrations`（标准部署布局）
//  3. 可执行文件所在目录的 `migrations`
//  4. 当前工作目录的 `migrations`（本地开发的老习惯，保留）
func Migrate(db *DB, dir string) error {
	dir = resolveMigrationsDir(dir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("读取迁移目录 %s: %w", dir, err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".sql" {
			files = append(files, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(files)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("读取迁移文件 %s: %w", f, err)
		}
		if _, err := db.Exec(string(b)); err != nil {
			return fmt.Errorf("执行迁移文件 %s: %w", f, err)
		}
	}
	return nil
}

// resolveMigrationsDir 定位 migrations 目录。
func resolveMigrationsDir(dir string) string {
	// 显式指定优先
	if dir != "" {
		if _, err := os.Stat(dir); err == nil {
			return dir
		}
	}
	if v := os.Getenv("MIGRATIONS_DIR"); v != "" {
		return v
	}
	// 从可执行文件位置推导
	if exe, err := os.Executable(); err == nil {
		base := filepath.Dir(exe)
		for _, cand := range []string{
			filepath.Join(base, "..", "migrations"),
			filepath.Join(base, "migrations"),
		} {
			if st, err := os.Stat(cand); err == nil && st.IsDir() {
				return cand
			}
		}
	}
	// 兜底：当前工作目录
	if dir == "" {
		return "migrations"
	}
	return dir
}
