pub const PRODUCT_KEY: &str = "HKQL-8CVG-5VUM-F1B4";
pub const MAX_ALLOWED_CONNECTED_DEVICES: u32 = 50;
pub const DEFAULT_MAX_CONNECTED_DEVICES: u32 = 10;
pub const MAX_ORGANIZATION_NAME_LEN: usize = 60;
pub const DEFAULT_BACKGROUND_COLOR: &str = "#EBE8E1";
pub const DEFAULT_FONT_SIZE: u32 = 14;
pub const DATE_FORMATS: [&str; 4] = ["long", "dmy", "mdy", "ymd"];
pub const DEFAULT_DATE_FORMAT: &str = "long";
pub const LANGUAGES: [&str; 2] = ["fr", "en"];
pub const DEFAULT_LANGUAGE: &str = "en";
pub const REGIONS: [&str; 25] = [
    "GB", "US", "CA", "AU", "IE", "FR", "BE", "CH", "LU", "DE", "AT", "ES", "PT", "IT", "NL", "SE",
    "BR", "MX", "CN", "JP", "KR", "IN", "ZA", "MG", "OTHER",
];
pub const DEFAULT_REGION: &str = "GB";
pub const MAX_TIMEZONE_LEN: usize = 64;
pub const MAX_CLOCK_OFFSET_SECS: i64 = 10 * 366 * 86_400;
pub const MAX_UTC_OFFSET_SECS: i32 = 18 * 3_600;
pub const MIN_FONT_SIZE: u32 = 8;
pub const MAX_FONT_SIZE: u32 = 32;
pub fn clamp_max_connected_devices(value: u32) -> u32 {
    value.min(MAX_ALLOWED_CONNECTED_DEVICES)
}
pub fn clamp_font_size(value: u32) -> u32 {
    value.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE)
}
