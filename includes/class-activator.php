<?php
/**
 * Activation, deactivation, and schema setup.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_Activator {

	/**
	 * Run on plugin activation.
	 */
	public static function activate(): void {
		self::create_tables();
		self::add_capabilities();
		update_option( 'storyboards_db_version', STORYBOARDS_DB_VERSION );

		if ( false === get_option( 'storyboards_license_key', false ) ) {
			add_option( 'storyboards_license_key', '', '', false );
		}

		// Ensure rewrite rules are registered then flushed.
		Storyboards_CPT::register();
		Storyboards_Rewrite::register_rewrites();
		flush_rewrite_rules();
	}

	/**
	 * Run on plugin deactivation.
	 */
	public static function deactivate(): void {
		flush_rewrite_rules();
	}

	/**
	 * Create custom database tables.
	 */
	public static function create_tables(): void {
		global $wpdb;

		$table           = self::scenes_table();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			storyboard_id bigint(20) unsigned NOT NULL,
			sort_order int(11) NOT NULL DEFAULT 0,
			role varchar(20) NOT NULL DEFAULT 'a_roll',
			title varchar(255) NOT NULL DEFAULT '',
			description longtext NOT NULL,
			script longtext NOT NULL,
			duration_sec int(11) NOT NULL DEFAULT 3,
			image_id bigint(20) unsigned DEFAULT NULL,
			created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY storyboard_id (storyboard_id),
			KEY storyboard_sort (storyboard_id, sort_order)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Grant manage_storyboards to administrators.
	 */
	public static function add_capabilities(): void {
		$role = get_role( 'administrator' );
		if ( $role ) {
			$role->add_cap( 'manage_storyboards' );
		}
	}

	/**
	 * Scenes table name with prefix.
	 */
	public static function scenes_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'storyboard_scenes';
	}

	/**
	 * Maybe upgrade schema on version bump.
	 */
	public static function maybe_upgrade(): void {
		$current = (string) get_option( 'storyboards_db_version', '0' );
		if ( version_compare( $current, STORYBOARDS_DB_VERSION, '<' ) ) {
			self::create_tables();
			self::add_capabilities();
			update_option( 'storyboards_db_version', STORYBOARDS_DB_VERSION );
		}
	}
}
