#[macro_export]
macro_rules! app_slug {
    () => {
        "light"
    };
}
pub const APP_NAME: &str = "Light";
pub const APP_SLUG: &str = app_slug!();
