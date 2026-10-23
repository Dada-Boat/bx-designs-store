# Turning on the BX Designs Design Library

The library page (`library.html`) lets designers sign in with their email, save designs online,
open them again from any computer, and share them in a gallery. It needs a free
[Supabase](https://supabase.com) project for sign-in, storage and the list of designs. This takes
about 10 minutes and is done once.

## 1. Create the Supabase project

1. Go to <https://supabase.com>, click **Start your project**, and sign up (GitHub sign-in works).
2. Click **New project**. Give it a name (for example `bx-designs`), choose a strong database
   password (keep it safe; the site never needs it), pick the region nearest your designers, and
   create it. Wait a minute while it starts.

## 2. Create the library's tables and storage

1. In the project, open **SQL Editor** › **New query**.
2. Paste everything in [`setup.sql`](setup.sql) and click **Run**. It should say "Success".
   (Running it again later is safe.)

## 3. Allow sign-in links to come back to the site

1. Open **Authentication** › **URL Configuration**.
2. Set **Site URL** to `https://dada-boat.github.io/bx-designs-store/library.html`.
3. Optionally, under **Redirect URLs**, add the same address (sign-in links already return to the
   Site URL; the list matters only if the library ever moves to another page).

The live project is **Dada-Boat's Project** (`sqancxhiapgedelenkoa`, organization BuildX
Multimedia): steps 1–4 were done on 2026-10-23.

Email sign-in is on by default. Supabase's built-in email service only sends a few messages per
hour; for real use, add your own email service under **Authentication** › **Emails** › **SMTP
Settings** (any provider such as Resend, Brevo or your domain's mail).

## 4. Connect the site

1. Open **Project Settings** › **API** (or **Data API**).
2. Copy the **Project URL** and the **anon public** key.
3. Put them in `config.js` in this repository:

   ```js
   window.BX_LIBRARY = {
     supabaseUrl: "https://YOUR-PROJECT.supabase.co",
     supabaseAnonKey: "eyJ...",
   };
   ```

4. Commit and push. Within a minute the library page opens for everyone.

The anon key is designed to be public. Never put the **service_role** key on the site: that one
bypasses every rule.

## What the rules do

- A designer sees, changes and deletes only their own designs. Everyone (signed in or not) can
  see and open designs their owners chose to share.
- Files are private in storage and reached through signed links that last an hour.
- Files are limited to 50 MB (previews to 5 MB) and to design and image types.

These rules are enforced by the database (Row Level Security), not only by the page.

## Community templates

Designers publish their own templates from the library page: **Publish as template** on a saved
design (with a category and a preview image), or the checkbox when saving. Published templates
appear in the template store for everyone, next to the built-in ones, with the designer's name.
The designer can **Withdraw** a template at any time.

Two fields are yours alone (designers can't change them; the database resets them):

- `hidden`: set it to `true` in **Table Editor** › `designs` to take a template (or a shared
  design) down without deleting it. Set it back to `false` to restore it.
- `price_cents`: 0 means free. The store only lists free templates for now; a price above 0 hides
  the template from the store until paid templates are added (checkout, and serving the file only
  after payment).

After updating `setup.sql`, run the whole file again in the SQL Editor: it is safe to re-run.

## Looking after it

- **Moderation:** shared designs and templates are public. To take one down, set its `hidden` to
  `true` in **Table Editor** › `designs`; to remove it for good, delete the row (then its files
  under **Storage** › `designs`).
- **Free tier limits:** about 1 GB of file storage and 50,000 monthly users. Supabase shows usage
  under **Project Settings** › **Usage**.
