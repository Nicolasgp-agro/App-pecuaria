-- Surco Claro: espacio para las fotos de facturas y lotes en la nube (Supabase Storage).
-- Usa las mismas fincas y miembros de Hato Claro. Cópielo completo en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez.

insert into storage.buckets (id, name, public, file_size_limit)
values ('surco-fotos', 'surco-fotos', false, 26214400)
on conflict (id) do nothing;

-- Las fotos se guardan como <id de la finca>/<id de la foto>; solo los miembros de esa finca las ven o suben.
drop policy if exists surco_fotos_ver on storage.objects;
create policy surco_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'surco-fotos' and public.rol_en(((storage.foldername(name))[1])::uuid) is not null);

drop policy if exists surco_fotos_subir on storage.objects;
create policy surco_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'surco-fotos' and public.rol_en(((storage.foldername(name))[1])::uuid) is not null);

drop policy if exists surco_fotos_cambiar on storage.objects;
create policy surco_fotos_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'surco-fotos' and public.rol_en(((storage.foldername(name))[1])::uuid) is not null);
