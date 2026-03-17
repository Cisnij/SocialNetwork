JAZZMIN_SETTINGS = {
    "site_title": "Social Network Admin",
    "site_header": "Social Network",
    "site_brand": "SocialNetwork",
    "site_logo": "images/logo-white.png",
    "login_logo": "images/logo-white.png",
    "login_logo_dark": "images/logo-white.png",
    "site_logo_classes": "img-circle",
    "site_icon": "images/favicon.png",
    "welcome_sign": "Welcome back 👋",
    "copyright": "© 2025 SocialNetwork",

    "user_avatar": "profile.picture",

    "search_model": [
        "auth.User",
        "socialnetwork.Post",
        "socialnetwork.Profile",
        "socialnetwork.Comment",
    ],

    "topmenu_links": [
        {"name": "Home",      "url": "admin:index", "permissions": ["auth.view_user"]},
        {"model": "auth.User"},
        {"app": "socialnetwork"},
        {"name": "Facebook",  "url": "https://www.facebook.com/chi.nghi.1607/", "new_window": True},
    ],

    "usermenu_links": [
        {"name": "Facebook", "url": "https://www.facebook.com/chi.nghi.1607/", "new_window": True},
        {"model": "auth.user"},
    ],

    "show_sidebar": True,
    "navigation_expanded": True,
    "hide_apps": [],
    "hide_models": [],

    "order_with_respect_to": [
        "auth",
        "socialnetwork",
        "friendship",
        "reaction",
        "actstream",
        "account",
        "socialaccount",
    ],

    "icons": {
        # ── Auth ──────────────────────────────────────────────
        "auth":                                  "fas fa-shield-alt",
        "auth.user":                             "fas fa-user-circle",
        "auth.Group":                            "fas fa-layer-group",

        # ── Social Network ────────────────────────────────────
        "socialnetwork.profile":                 "fas fa-id-card",
        "socialnetwork.pendingprofile":          "fas fa-user-clock",
        "socialnetwork.post":                    "fas fa-newspaper",
        "socialnetwork.postphoto":               "fas fa-images",
        "socialnetwork.postarticle":             "fas fa-file-alt",
        "socialnetwork.comment":                 "fas fa-comment-dots",
        "socialnetwork.setting":                 "fas fa-sliders-h",
        "socialnetwork.log":                     "fas fa-history",
        "socialnetwork.notification":            "fas fa-bell",

        # Chat
        "socialnetwork.conversation":            "fas fa-comments",
        "socialnetwork.conversationmember":      "fas fa-users",
        "socialnetwork.message":                 "fas fa-envelope-open-text",
        "socialnetwork.messageattachment":       "fas fa-paperclip",

        # Firebase
        "socialnetwork.fcmtoken":                "fas fa-mobile-alt",

        # ── Friendship ────────────────────────────────────────
        "friendship.friend":                     "fas fa-user-friends",
        "friendship.friendshiprequest":          "fas fa-user-plus",
        "friendship.follow":                     "fas fa-rss",
        "friendship.block":                      "fas fa-ban",

        # ── Reaction ──────────────────────────────────────────
        "reaction.reaction":                     "fas fa-thumbs-up",
        "reaction.userreaction":                 "fas fa-heart",
        "reaction.reactionsettings":             "fas fa-cog",

        # ── Activity Stream ───────────────────────────────────
        "actstream.action":                      "fas fa-stream",
        "actstream.follow":                      "fas fa-link",

        # ── Allauth / Email ───────────────────────────────────
        "account.emailaddress":                  "fas fa-envelope",
        "account.emailconfirmation":             "fas fa-check-circle",
        "socialaccount.socialaccount":           "fas fa-globe",
        "socialaccount.socialapp":               "fas fa-plug",
        "socialaccount.socialtoken":             "fas fa-key",
    },

    "default_icon_parents":  "fas fa-folder-open",
    "default_icon_children": "fas fa-dot-circle",

    "related_modal_active": True,

    "changeform_format": "horizontal_tabs",
    "changeform_format_overrides": {
        "auth.user":                   "collapsible",
        "socialnetwork.profile":       "carousel",
        "socialnetwork.conversation":  "horizontal_tabs",
    },

    "custom_links": {
        "socialnetwork": [
            {
                "name": "Post Analytics",
                "url": "/admin/socialnetwork/post/",
                "icon": "fas fa-chart-bar",
                "permissions": ["socialnetwork.view_post"],
            },
            {
                "name": "Active Users",
                "url": "/admin/auth/user/?is_active__exact=1",
                "icon": "fas fa-user-check",
                "permissions": ["auth.view_user"],
            },
        ]
    },

    "show_ui_builder": False,
    "language_chooser": False,
}

JAZZMIN_UI_TWEAKS = {
    "theme": "darkly",
    "accent": "accent-teal",

    "navbar": "navbar-dark bg-dark",
    "no_navbar_border": True,
    "navbar_fixed": True,

    "sidebar": "sidebar-dark-teal",
    "sidebar_fixed": True,
    "sidebar_nav_child_indent": True,
    "sidebar_nav_compact_style": True,
    "sidebar_nav_legacy_style": False,
    "sidebar_disable_expand": False,

    "layout_boxed": False,
    "footer_fixed": False,
    "actions_sticky_top": True,

    "body_small_text": False,
    "footer_small_text": True,
    "brand_small_text": False,

    "button_classes": {
        "primary":   "btn btn-primary",
        "secondary": "btn btn-outline-secondary",
        "info":      "btn btn-info",
        "warning":   "btn btn-warning",
        "danger":    "btn btn-danger",
        "success":   "btn btn-success",
    },
}