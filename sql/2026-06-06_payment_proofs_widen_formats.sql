-- p1_374 (2026-06-06): Perbanyakkan format gambar diterima untuk resit pembayaran.
-- PUNCA: Ariff snap dari iPad -> format image/heif (bukan image/heic). Bucket dulu
-- whitelist [image/jpeg, image/png, image/webp, image/heic, application/pdf] -> heif DITOLAK.
-- Foto iPad resolusi tinggi pun selalu >5MB (had lama).
-- FIX: terima SEMUA jenis gambar (image/*) + pdf; naikkan had saiz 5MB -> 10MB.

update storage.buckets
set allowed_mime_types = array['image/*','application/pdf'],
    file_size_limit = 10485760  -- 10 MB
where id = 'payment-proofs';
