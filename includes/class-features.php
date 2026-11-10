<?php
/**
 * Feature flags and premium stubs.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_Features {

	/**
	 * Whether a named feature is enabled.
	 *
	 * Free MVP: all premium features return false unless filtered.
	 * Future: wire to STRGL license validation (POST /api/v1/licenses/validate).
	 *
	 * @param string $feature Feature slug, e.g. ai_description, ai_script, ai_image.
	 */
	public static function enabled( string $feature ): bool {
		$premium = array(
			'ai_description' => false,
			'ai_script'      => false,
			'ai_image'       => false,
		);

		$default = $premium[ $feature ] ?? false;

		/**
		 * Filter whether a Storyboards feature is enabled.
		 *
		 * @param bool   $enabled Whether the feature is enabled.
		 * @param string $feature Feature slug.
		 */
		return (bool) apply_filters( 'storyboards_feature_enabled', $default, $feature );
	}

	/**
	 * Public payload for the frontend app.
	 *
	 * @return array<string, mixed>
	 */
	public static function frontend_payload(): array {
		return array(
			'ai_description' => self::enabled( 'ai_description' ),
			'ai_script'      => self::enabled( 'ai_script' ),
			'ai_image'       => self::enabled( 'ai_image' ),
			'premium_hint'   => __( 'Premium — coming soon', 'storyboards' ),
		);
	}
}
