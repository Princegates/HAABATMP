-- Which stored PDF (storage key, which contains a hash of everything printed on it) is the current copy of a certificate.
-- Null means none has been made yet. Used to serve downloads without rebuilding the PDF, and by the background job to
-- prepare certificates ahead of time.
alter table certificates add column pdf_key text;
create index certificates_pdf_missing_idx on certificates (created_at) where pdf_key is null and status = 'valid';
