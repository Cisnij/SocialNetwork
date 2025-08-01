#tùy chỉnh jazz min
JAZZMIN_SETTINGS = {
    "site_title": "SOCIAL NETWORK ADMIN",
    "site_header": "SOCIAL NETWORK",
    "site_brand": "SOCIAL NETWORK",
    "site_logo": "images/logo-white.png",
    "login_logo": "images/logo-white.png",
    "login_logo_dark": "images/logo-white.png",
    "site_logo_classes": "img-circle elevation-3",
    "site_icon": "images/favicon.png",  # favicon
    "welcome_sign": "👋 Welcome to Social Admin Dashboard",
    "copyright": "© 2025 Social Co.",
    "search_model": ["auth.User", "socialnetwork.Post"],

    "user_avatar": "profile.picture",

    "topmenu_links": [
        {"name": "🏠 Home", "url": "/", "permissions": ["auth.view_user"]},
        {"model": "auth.User"},
        {"app": "socialnetwork"},
        {"name": "💬 Support", "url": "https://t.me/yourchannel", "new_window": True},
    ],

    "usermenu_links": [
        {"name": "Documentation", "url": "https://docs.djangoproject.com/", "new_window": True},
        {"model": "auth.user"},
    ],

    "show_sidebar": True,
    "navigation_expanded": True,
    "hide_apps": [],
    "hide_models": [],
    "order_with_respect_to": ["auth", "socialnetwork"],

    "custom_links": {
        "socialnetwork": [
            {
                "name": "📊 Thống kê",
                "url": "admin/socialnetwork/post/",
                "icon": "fas fa-chart-line",
                "permissions": ["socialnetwork.view_post"]
            },
            {
                "name": "📁 Tải dữ liệu",
                "url": "/admin/socialnetwork/post/export/",
                "icon": "fas fa-download",
            },
        ]
    },

    "icons": {
        "auth": "fas fa-users",
        "auth.user": "fas fa-user",
        "auth.Group": "fas fa-users-cog",
        "socialnetwork.post": "fas fa-photo-video",
        "socialnetwork.comment": "fas fa-comments",
        "socialnetwork.profile": "fas fa-id-badge",
    },

    "related_modal_active": True,
    "changeform_format": "horizontal_tabs",  # tab
    "changeform_format_overrides": {
        "auth.user": "collapsible",
        "socialnetwork.profile": "carousel",
    },

    "language_chooser": True,

    # Footer links
    "show_ui_builder": True,
}
JAZZMIN_UI_TWEAKS = {
    "theme": "cyborg",  # "darkly", "superhero", "lux" cũng đẹp
    "accent": "accent-pink",
    "navbar": "navbar-dark bg-primary",
    "no_navbar_border": False,
    "navbar_fixed": True,
    "layout_boxed": False,
    "footer_fixed": False,
    "sidebar_fixed": True,
    "sidebar": "sidebar-dark-primary",
    "sidebar_nav_child_indent": True,
    "sidebar_nav_compact_style": False,
    "sidebar_nav_legacy_style": False,
    "sidebar_disable_expand": False,
    "actions_sticky_top": True,
    "small_text": "md",
    "brand_small_text": False,
    "footer_small_text": False,
    "body_small_text": False,
    "button_classes": {
        "primary": "btn btn-outline-warning",
        "secondary": "btn btn-outline-light",
    },
}
