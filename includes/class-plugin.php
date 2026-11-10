<?php
/**
 * Main plugin bootstrap.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_Plugin {

	private static ?self $instance = null;

	private function __construct() {}

	/**
	 * Singleton accessor.
	 */
	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Wire components.
	 */
	public function init(): void {
		Storyboards_Activator::maybe_upgrade();

		( new Storyboards_CPT() )->register_hooks();
		( new Storyboards_Rewrite() )->register_hooks();
		( new Storyboards_REST() )->register_hooks();
	}
}
