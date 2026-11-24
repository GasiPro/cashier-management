pub const DEFAULT_CURRENCY: &str = "USD";
pub const MIN_CURRENCY_CODE_LEN: usize = 2;
pub const MAX_CURRENCY_CODE_LEN: usize = 6;
pub const MAX_CURRENCY_NAME_LEN: usize = 40;
pub const MAX_CUSTOM_CURRENCIES: usize = 50;
pub const MAX_PRICE_HISTORY_ENTRIES: usize = 2000;
pub const MAX_DENOMINATIONS: usize = 50;
pub const MAX_DENOMINATION_VALUE: u32 = 1_000_000_000;
pub const MIN_RATE_PERCENT: u32 = 1;
pub const MAX_RATE_PERCENT: u32 = 100;
pub const MAX_MOR_DAYS: u32 = 3650;
pub const MAX_MOR_ORDERS: u32 = 1_000_000;
pub const PRESET_CURRENCIES: &[(&str, &str)] = &[
    ("AED", "Dirham des Émirats arabes unis"),
    ("AOA", "Kwanza angolais"),
    ("AUD", "Dollar australien"),
    ("BRL", "Réal brésilien"),
    ("BWP", "Pula botswanais"),
    ("CAD", "Dollar canadien"),
    ("CHF", "Franc suisse"),
    ("CNY", "Yuan chinois"),
    ("CZK", "Couronne tchèque"),
    ("DKK", "Couronne danoise"),
    ("DZD", "Dinar algérien"),
    ("EGP", "Livre égyptienne"),
    ("ETB", "Birr éthiopien"),
    ("EUR", "Euro"),
    ("GBP", "Livre sterling"),
    ("GHS", "Cedi ghanéen"),
    ("HKD", "Dollar de Hong Kong"),
    ("IDR", "Roupie indonésienne"),
    ("ILS", "Shekel israélien"),
    ("INR", "Roupie indienne"),
    ("JPY", "Yen japonais"),
    ("KES", "Shilling kényan"),
    ("KMF", "Franc comorien"),
    ("KRW", "Won sud-coréen"),
    ("MAD", "Dirham marocain"),
    ("MGA", "Ariary malgache"),
    ("MUR", "Roupie mauricienne"),
    ("MXN", "Peso mexicain"),
    ("MYR", "Ringgit malaisien"),
    ("MZN", "Metical mozambicain"),
    ("NAD", "Dollar namibien"),
    ("NGN", "Naira nigérian"),
    ("NOK", "Couronne norvégienne"),
    ("NZD", "Dollar néo-zélandais"),
    ("PHP", "Peso philippin"),
    ("PKR", "Roupie pakistanaise"),
    ("PLN", "Zloty polonais"),
    ("RUB", "Rouble russe"),
    ("RWF", "Franc rwandais"),
    ("SAR", "Riyal saoudien"),
    ("SCR", "Roupie seychelloise"),
    ("SEK", "Couronne suédoise"),
    ("SGD", "Dollar de Singapour"),
    ("THB", "Baht thaïlandais"),
    ("TND", "Dinar tunisien"),
    ("TRY", "Livre turque"),
    ("TZS", "Shilling tanzanien"),
    ("UGX", "Shilling ougandais"),
    ("USD", "Dollar américain"),
    ("VND", "Dong vietnamien"),
    ("XAF", "Franc CFA (BEAC)"),
    ("XOF", "Franc CFA (BCEAO)"),
    ("ZAR", "Rand sud-africain"),
    ("ZMW", "Kwacha zambien"),
];
