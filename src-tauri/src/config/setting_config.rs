pub const MAX_ALLOWED_CONNECTED_DEVICES: u32 = 50;
pub const DEFAULT_MAX_CONNECTED_DEVICES: u32 = 10;
pub const DEFAULT_BACKGROUND_COLOR: &str = "#EBE8E1";
pub const DEFAULT_FONT_SIZE: u32 = 14;
pub const MIN_FONT_SIZE: u32 = 8;
pub const MAX_FONT_SIZE: u32 = 32;
pub fn clamp_max_connected_devices(value: u32) -> u32 {
    value.min(MAX_ALLOWED_CONNECTED_DEVICES)
}
pub fn clamp_font_size(value: u32) -> u32 {
    value.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE)
}
