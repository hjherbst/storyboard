<?php
/**
 * Uninstall cleanup.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

global $wpdb;

$scenes = $wpdb->prefix . 'storyboard_scenes';
$audio  = $wpdb->prefix . 'storyboard_audio';

// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
$wpdb->query( "DROP TABLE IF EXISTS {$scenes}" );
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
$wpdb->query( "DROP TABLE IF EXISTS {$audio}" );

$boards = get_posts(
	array(
		'post_type'      => 'storyboard',
		'post_status'    => 'any',
		'posts_per_page' => -1,
		'fields'         => 'ids',
	)
);

foreach ( $boards as $board_id ) {
	wp_delete_post( (int) $board_id, true );
}

delete_option( 'storyboards_db_version' );
delete_option( 'storyboards_license_key' ); // legacy
delete_option( 'storyboards_license_cache' ); // legacy
delete_option( 'storyboards_public_viewing' ); // legacy
delete_option( 'storyboards_rewrite_version' );
delete_transient( 'storyboards_credits_balance' ); // legacy

$role = get_role( 'administrator' );
if ( $role ) {
	$role->remove_cap( 'manage_storyboards' );
}
