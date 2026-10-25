<?php
// Removes the plugin's settings when it is deleted from WordPress. Orders are never touched.
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
foreach (['app_url', 'store_id', 'secret', 'enabled', 'admin_only'] as $k) {
    delete_option('growpefy_' . $k);
}
