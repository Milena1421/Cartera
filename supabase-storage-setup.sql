insert into storage.buckets (id, name, public)
values ('invoice-documents', 'invoice-documents', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'invoice_documents_select'
  ) then
    create policy "invoice_documents_select"
    on storage.objects for select
    using (bucket_id = 'invoice-documents');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'invoice_documents_insert'
  ) then
    create policy "invoice_documents_insert"
    on storage.objects for insert
    with check (bucket_id = 'invoice-documents');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'invoice_documents_update'
  ) then
    create policy "invoice_documents_update"
    on storage.objects for update
    using (bucket_id = 'invoice-documents')
    with check (bucket_id = 'invoice-documents');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'invoice_documents_delete'
  ) then
    create policy "invoice_documents_delete"
    on storage.objects for delete
    using (bucket_id = 'invoice-documents');
  end if;
end $$;
