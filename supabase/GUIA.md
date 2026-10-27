# Activar la nube de Hato Claro (Supabase)

Con esto la finca se guarda en la nube, se ve en varios celulares y el dueño puede invitar al ordeñador o al veterinario. Toma unos 15 minutos y el plan gratis alcanza para el piloto.

## 1. Crear el proyecto
1. Entre a https://supabase.com y cree una cuenta (puede usar la de GitHub).
2. **New project** → nombre `hato-claro`, una contraseña de base de datos (guárdela) y región **South America (São Paulo)**.
3. Espere a que termine de crearse.

## 2. Crear las tablas y las reglas de seguridad
1. Menú izquierdo → **SQL Editor** → **New query**.
2. Copie todo el archivo `supabase/esquema.sql` de este repositorio, péguelo y toque **Run**.
3. Debe decir *Success*. Se puede correr otra vez sin dañar nada.

## 3. Entrar con código al correo
1. **Authentication → Sign In / Providers → Email**: deje activado *Email* y desactive *Confirm email* si aparece.
2. **Authentication → Emails → Magic Link**: cambie el texto del mensaje para que muestre el código, por ejemplo:
   `Su código para entrar a Hato Claro es: {{ .Token }}`
3. **Authentication → URL Configuration → Site URL**: `https://nicolasgp-agro.github.io/App-pecuaria/`

Nota: el correo gratuito de Supabase permite pocos envíos por hora. Para más usuarios se configura un servicio de correo propio (por ejemplo Resend) en *Authentication → Emails → SMTP Settings*.

## 4. Pasarle las llaves a la app
En **Project Settings → API** copie:
- **Project URL** (algo como `https://abcd1234.supabase.co`)
- **anon public** key

Con esos dos datos se crea el archivo `nube.json` en el repositorio:

```json
{ "url": "https://abcd1234.supabase.co", "anonKey": "eyJ..." }
```

La llave *anon* es pública por diseño: lo que protege los datos son las reglas de seguridad del paso 2. **Nunca** comparta la llave *service_role*.

## Cómo funciona
- Cada celular sigue guardando todo localmente y funciona sin señal. Cuando hay señal, envía sus cambios y recibe los de los demás.
- Roles: **Dueño** ve y hace todo e invita. **Ordeñador** y **Veterinario** registran hato, leche, salud y potreros, pero no ven liquidaciones, gastos ni precios. Esto lo hace cumplir la base de datos, no solo la app.
- Si dos personas cambian el mismo registro sin señal, queda el último que se sincronice.
- Los proyectos gratis de Supabase se pausan si pasan una semana sin uso; se reactivan desde el panel.
