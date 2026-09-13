# JSON intake from the source script

The extraction script sends one `POST` request to:

`https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/ingest-source-listing`

The script must send the secret in `x-source-intake-token`. Configure the same secret as
`SOURCE_INTAKE_TOKEN` in Supabase Edge Function secrets. Never put it in GitHub or the web app.

```json
{
  "draft_id": "optional-existing-draft-uuid",
  "source": {
    "type": "encar",
    "url": "https://fem.encar.com/cars/detail/42607542",
    "listing_id": "42607542",
    "vin": "optional-vin",
    "price_eur": 24500
  },
  "fields": {
    "category": "Автомобили и джипове",
    "make": "Kia",
    "model": "Sorento",
    "year": 2023,
    "mileage": 42100,
    "fuel": "Дизел",
    "gearbox": "Автоматична",
    "color": "Черен",
    "condition": "Използван",
    "drivetrain": "4x4",
    "price": 28500,
    "currency": "EUR",
    "location": "Варна",
    "seller_name": "AUTO IMPORT",
    "phone": "+359...",
    "ad_type": "Стандартна",
    "description_auto": "Описание, създадено от скрипта"
  },
  "extras": [
    { "key": "abs", "label": "ABS", "group": "Безопасност", "proof": "source options" },
    { "key": "heated_seats_front", "label": "Подгряване на предни седалки", "group": "Комфорт" }
  ],
  "images": [
    { "source_url": "https://.../photo1.jpg", "is_main": true, "selected": true, "display_order": 1 }
  ]
}
```

The endpoint preserves the complete original payload, updates an existing draft when `draft_id`
is supplied, and is idempotent for fields and extras. It never publishes to Mobile.bg. A draft
becomes `READY_FOR_REVIEW` only after all required review fields have values; otherwise it remains
`DRAFT` and returns the missing field keys.
