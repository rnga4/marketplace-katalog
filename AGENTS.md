<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.agents/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.agents/skills/antislop-ui/SKILL.md`
- Copy & text: `antislop-copywriting`: `.agents/skills/antislop-copywriting/SKILL.md`
- People: `antislop-human`: `.agents/skills/antislop-human/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.agents/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `antislop-code`: `.agents/skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->

## Operasi database (setelah migrasi ke Postgres, 4 Oktober 2026)
- Produksi berjalan di Postgres. `data/hp.db` sekarang hanya arsip hasil migrasi;
  jangan diedit dan jangan jadi sumber kebenaran.
- `scripts/uji-db.ts` bersifat mutating: ia mengubah kata sandi admin di tabel
  `pengaturan` dan tidak memulihkannya. Jalankan hanya di database sekali pakai.
- Konsekuensi: database staging tidak boleh pernah dipromosikan ke produksi. Isinya
  sudah tercemar kata sandi uji.
- Backup SQLite lama wajib menyertakan `-wal`. `cp data/hp.db` saja menghasilkan
  berkas yang tabelnya hilang. Yang benar `VACUUM INTO` atau `sqlite3 .backup`;
  file WAL pernah 1,1 MB dan belum checkpoint sejak 30 September.
- `session_secret` di Postgres harus sama dengan isi `data/.secret`. Kalau berbeda,
  semua orang logout. `docker/entrypoint.sh` tidak lagi membuat `.secret`; jangan
  dibalik tanpa migrate ulang nilainya.
- `ADMIN_PASSWORD` hanya berlaku saat tabel `pengaturan` masih kosong. Setelah
  migrasi, kata sandi admin adalah milik lama, bukan nilai env itu.
- Belum dikerjakan: SSG dengan rebuild-on-write, dan named Cloudflare Tunnel
  (sekarang masih quick tunnel `*.trycloudflare.com`).
