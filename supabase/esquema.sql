-- Hato Claro: esquema de la nube (Supabase / PostgreSQL)
-- Cópielo completo en Supabase → SQL Editor → New query → Run. Se puede correr más de una vez.
--
-- Modelo: cada finca tiene miembros con un rol (dueño, ordeñador, veterinario).
-- Todos los registros de la app (animales, eventos, entregas, etc.) se guardan en una
-- sola tabla "registros" como documentos JSON. Las reglas de seguridad (RLS) de la base
-- de datos impiden que alguien vea o cambie datos de una finca que no es suya, y que el
-- ordeñador o el veterinario vean la plata (liquidaciones, gastos y precios).

create table if not exists public.fincas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  creado_por uuid not null default auth.uid() references auth.users(id) on delete cascade,
  creado timestamptz not null default now()
);

create table if not exists public.miembros (
  finca_id uuid not null references public.fincas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('dueno', 'ordenador', 'veterinario')),
  creado timestamptz not null default now(),
  primary key (finca_id, user_id)
);

create table if not exists public.registros (
  finca_id uuid not null references public.fincas(id) on delete cascade,
  coleccion text not null,
  id text not null,
  datos jsonb not null default '{}'::jsonb,
  borrado boolean not null default false,
  actualizado timestamptz not null default now(),
  modificado_por uuid default auth.uid(),
  primary key (finca_id, coleccion, id)
);
create index if not exists registros_finca_actualizado on public.registros (finca_id, actualizado);

create table if not exists public.invitaciones (
  codigo text primary key,
  finca_id uuid not null references public.fincas(id) on delete cascade,
  rol text not null check (rol in ('dueno', 'ordenador', 'veterinario')),
  creado_por uuid default auth.uid(),
  expira timestamptz not null default now() + interval '7 days',
  usada_por uuid
);

-- Rol del usuario actual en una finca (null si no es miembro)
create or replace function public.rol_en(f uuid) returns text
language sql stable security definer set search_path = public as $$
  select rol from public.miembros where finca_id = f and user_id = auth.uid()
$$;

-- ¿Puede el usuario actual ver o escribir este registro?
create or replace function public.puede(f uuid, col text, doc text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.rol_en(f)
    when 'dueno' then true
    when 'ordenador' then col not in ('liquidaciones', 'gastos') and not (col = 'config' and doc in ('costos', 'precios'))
    when 'veterinario' then col not in ('liquidaciones', 'gastos') and not (col = 'config' and doc in ('costos', 'precios'))
    else false
  end
$$;

-- Marca la hora del servidor en cada cambio (la app la usa para saber qué bajar)
create or replace function public.tocar_registro() returns trigger
language plpgsql as $$
begin
  new.actualizado := clock_timestamp();
  new.modificado_por := auth.uid();
  return new;
end $$;
drop trigger if exists registros_tocar on public.registros;
create trigger registros_tocar before insert or update on public.registros
  for each row execute function public.tocar_registro();

-- Quien crea una finca queda como dueño
create or replace function public.finca_nueva() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.miembros (finca_id, user_id, rol) values (new.id, new.creado_por, 'dueno')
  on conflict (finca_id, user_id) do nothing;
  return new;
end $$;
drop trigger if exists fincas_dueno on public.fincas;
create trigger fincas_dueno after insert on public.fincas
  for each row execute function public.finca_nueva();

-- Seguridad por fila
alter table public.fincas enable row level security;
alter table public.miembros enable row level security;
alter table public.registros enable row level security;
alter table public.invitaciones enable row level security;

drop policy if exists fincas_ver on public.fincas;
create policy fincas_ver on public.fincas for select to authenticated using (public.rol_en(id) is not null);
drop policy if exists fincas_crear on public.fincas;
drop policy if exists fincas_editar on public.fincas;
create policy fincas_editar on public.fincas for update to authenticated using (public.rol_en(id) = 'dueno');

drop policy if exists miembros_ver on public.miembros;
create policy miembros_ver on public.miembros for select to authenticated using (public.rol_en(finca_id) is not null);

drop policy if exists registros_ver on public.registros;
create policy registros_ver on public.registros for select to authenticated using (public.puede(finca_id, coleccion, id));
drop policy if exists registros_crear on public.registros;
create policy registros_crear on public.registros for insert to authenticated with check (public.puede(finca_id, coleccion, id));
drop policy if exists registros_editar on public.registros;
create policy registros_editar on public.registros for update to authenticated
  using (public.puede(finca_id, coleccion, id)) with check (public.puede(finca_id, coleccion, id));
-- invitaciones y miembros solo se manejan con las funciones de abajo

-- Crear una finca (quien la crea queda como dueño)
create or replace function public.crear_finca(n text) returns uuid
language plpgsql security definer set search_path = public as $$
declare f uuid;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  insert into public.fincas (nombre, creado_por) values (coalesce(nullif(trim(n), ''), 'Mi finca'), auth.uid()) returning id into f;
  return f;
end $$;

-- Invitar: el dueño genera un código de 6 letras válido por 7 días
create or replace function public.crear_invitacion(f uuid, r text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if public.rol_en(f) is distinct from 'dueno' then raise exception 'Solo el dueño puede invitar'; end if;
  if r not in ('dueno', 'ordenador', 'veterinario') then raise exception 'Rol no válido'; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  insert into public.invitaciones (codigo, finca_id, rol, creado_por) values (c, f, r, auth.uid());
  return c;
end $$;

-- Unirse a una finca con el código
create or replace function public.unirse_finca(c text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.invitaciones;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  select * into inv from public.invitaciones where codigo = upper(trim(c)) and expira > now() and usada_por is null;
  if not found then raise exception 'Código no válido o vencido'; end if;
  insert into public.miembros (finca_id, user_id, rol) values (inv.finca_id, auth.uid(), inv.rol)
    on conflict (finca_id, user_id) do update set rol = excluded.rol;
  update public.invitaciones set usada_por = auth.uid() where codigo = inv.codigo;
  return inv.finca_id;
end $$;

-- Ver quiénes están en la finca
create or replace function public.miembros_de(f uuid) returns table (user_id uuid, email text, rol text)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.rol
  from public.miembros m join auth.users u on u.id = m.user_id
  where m.finca_id = f and public.rol_en(f) is not null
  order by m.creado
$$;

-- El dueño puede sacar a alguien de la finca
create or replace function public.quitar_miembro(f uuid, u uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.rol_en(f) is distinct from 'dueno' then raise exception 'Solo el dueño puede quitar miembros'; end if;
  if u = auth.uid() then raise exception 'No puede quitarse a sí mismo'; end if;
  delete from public.miembros where finca_id = f and user_id = u;
end $$;

revoke all on function public.crear_finca(text), public.crear_invitacion(uuid, text), public.unirse_finca(text), public.miembros_de(uuid), public.quitar_miembro(uuid, uuid) from public, anon;
grant execute on function public.crear_finca(text), public.crear_invitacion(uuid, text), public.unirse_finca(text), public.miembros_de(uuid), public.quitar_miembro(uuid, uuid) to authenticated;
grant select, update on public.fincas to authenticated;
grant select, insert, update on public.registros to authenticated;
grant select on public.miembros to authenticated;
