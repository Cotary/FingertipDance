package core

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Migrate 执行 migrations 目录下的所有 .sql 文件（按文件名排序）。
func Migrate(db *DB, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("读取迁移目录: %w", err)
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
