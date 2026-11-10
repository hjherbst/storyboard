<?php
/**
 * GitHub-based plugin updates via plugin-update-checker.
 *
 * Releases: tag vX.Y.Z on https://github.com/hjherbst/storyboard
 * CI attaches storyboards.zip; WP sites pick it up automatically.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_Updater {

	public const GITHUB_REPO = 'https://github.com/hjherbst/storyboard/';
	public const SLUG        = 'storyboards';

	/**
	 * Boot the update checker when the library is present.
	 */
	public static function init(): void {
		$loader = STORYBOARDS_PATH . 'lib/plugin-update-checker/plugin-update-checker.php';
		if ( ! is_readable( $loader ) ) {
			return;
		}

		require_once $loader;

		if ( ! class_exists( '\YahnisElsts\PluginUpdateChecker\v5\PucFactory' ) ) {
			return;
		}

		$checker = \YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker(
			self::GITHUB_REPO,
			STORYBOARDS_FILE,
			self::SLUG
		);

		// Prefer the CI-built zip asset over the raw source archive.
		$api = $checker->getVcsApi();
		if ( $api && method_exists( $api, 'enableReleaseAssets' ) ) {
			$api->enableReleaseAssets( '/storyboards\.zip($|[?&#])/i' );
		}
	}
}
