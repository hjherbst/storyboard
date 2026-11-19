<?php
/**
 * wp-admin: dashboard overview widget.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_Admin {

	/**
	 * Register hooks.
	 */
	public function register_hooks(): void {
		add_action( 'wp_dashboard_setup', array( __CLASS__, 'register_dashboard_widget' ) );
		add_filter( 'get_user_option_meta-box-order_dashboard', array( __CLASS__, 'pin_dashboard_widget' ) );
	}

	/**
	 * Register the Storyboards overview widget and move it to the top.
	 */
	public static function register_dashboard_widget(): void {
		if ( ! current_user_can( 'manage_storyboards' ) ) {
			return;
		}

		wp_add_dashboard_widget(
			'storyboards_overview',
			__( 'Storyboards', 'storyboards' ),
			array( __CLASS__, 'render_dashboard_widget' )
		);

		global $wp_meta_boxes;
		if ( empty( $wp_meta_boxes['dashboard']['normal']['core']['storyboards_overview'] ) ) {
			return;
		}

		$widget = $wp_meta_boxes['dashboard']['normal']['core']['storyboards_overview'];
		unset( $wp_meta_boxes['dashboard']['normal']['core']['storyboards_overview'] );
		$wp_meta_boxes['dashboard']['normal']['core'] = array_merge(
			array( 'storyboards_overview' => $widget ),
			$wp_meta_boxes['dashboard']['normal']['core']
		);
	}

	/**
	 * Keep the Storyboards widget first in the normal dashboard column.
	 *
	 * @param array<string,string>|false $order Saved meta-box order.
	 * @return array<string,string>|false
	 */
	public static function pin_dashboard_widget( $order ) {
		if ( ! current_user_can( 'manage_storyboards' ) ) {
			return $order;
		}

		if ( ! is_array( $order ) ) {
			$order = array();
		}

		$normal = isset( $order['normal'] ) ? explode( ',', (string) $order['normal'] ) : array();
		$normal = array_values(
			array_filter(
				array_map( 'trim', $normal ),
				static fn( string $id ): bool => '' !== $id && 'storyboards_overview' !== $id
			)
		);
		array_unshift( $normal, 'storyboards_overview' );
		$order['normal'] = implode( ',', $normal );

		return $order;
	}

	/**
	 * Dashboard widget markup.
	 */
	public static function render_dashboard_widget(): void {
		$boards = get_posts(
			array(
				'post_type'              => Storyboards_CPT::POST_TYPE,
				// Boards are created as private (see REST create_board).
				'post_status'            => array( 'publish', 'private' ),
				'posts_per_page'         => 50,
				'orderby'                => 'modified',
				'order'                  => 'DESC',
				'no_found_rows'          => true,
				'update_post_meta_cache' => true,
				'update_post_term_cache' => false,
			)
		);

		$app_url = Storyboards_Rewrite::app_url();
		echo '<p class="sb-dash-actions">';
		echo '<a class="button button-primary" href="' . esc_url( $app_url ) . '">' . esc_html__( 'Open Storyboards', 'storyboards' ) . '</a>';
		echo '</p>';

		if ( empty( $boards ) ) {
			echo '<p>' . esc_html__( 'No boards yet.', 'storyboards' ) . '</p>';
			return;
		}

		$stats = self::boards_stats( array_map( static fn( WP_Post $p ): int => (int) $p->ID, $boards ) );

		echo '<table class="widefat striped sb-dash-table"><thead><tr>';
		echo '<th>' . esc_html__( 'Board', 'storyboards' ) . '</th>';
		echo '<th>' . esc_html__( 'Scenes', 'storyboards' ) . '</th>';
		echo '<th>' . esc_html__( 'Duration', 'storyboards' ) . '</th>';
		echo '</tr></thead><tbody>';

		foreach ( $boards as $post ) {
			$id     = (int) $post->ID;
			$slug   = (string) $post->post_name;
			$url    = Storyboards_Rewrite::board_url( $slug );
			$row    = $stats[ $id ] ?? array( 'scene_count' => 0, 'total_duration_sec' => 0 );
			$count  = (int) $row['scene_count'];
			$dur    = self::format_duration( (int) $row['total_duration_sec'] );
			$aspect = Storyboards_CPT::sanitize_aspect(
				(string) get_post_meta( $id, Storyboards_CPT::META_ASPECT, true )
			);

			echo '<tr>';
			echo '<td><a href="' . esc_url( $url ) . '"><strong>' . esc_html( $post->post_title ) . '</strong></a>';
			echo '<br><span class="description">' . esc_html( $aspect ) . '</span></td>';
			echo '<td>' . esc_html( (string) $count ) . '</td>';
			echo '<td>' . esc_html( $dur ) . '</td>';
			echo '</tr>';
		}

		echo '</tbody></table>';
	}

	/**
	 * @param list<int> $board_ids Board post IDs.
	 * @return array<int, array{scene_count:int,total_duration_sec:int}>
	 */
	private static function boards_stats( array $board_ids ): array {
		global $wpdb;

		$board_ids = array_values( array_filter( array_map( 'intval', $board_ids ) ) );
		if ( empty( $board_ids ) ) {
			return array();
		}

		$table = $wpdb->prefix . 'storyboard_scenes';
		$in    = implode( ',', $board_ids );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- IDs are cast to int.
		$rows  = $wpdb->get_results(
			"SELECT storyboard_id,
				COUNT(*) AS scene_count,
				COALESCE(SUM(CASE WHEN role = 'a_roll' THEN duration_sec ELSE 0 END), 0) AS total_duration_sec
			FROM {$table}
			WHERE storyboard_id IN ({$in})
			GROUP BY storyboard_id"
		);

		$out = array();
		foreach ( (array) $rows as $row ) {
			$out[ (int) $row->storyboard_id ] = array(
				'scene_count'        => (int) $row->scene_count,
				'total_duration_sec' => (int) $row->total_duration_sec,
			);
		}
		return $out;
	}

	/**
	 * Format seconds like the frontend (e.g. 1m 05s).
	 */
	private static function format_duration( int $sec ): string {
		$sec = max( 0, $sec );
		$m   = intdiv( $sec, 60 );
		$s   = $sec % 60;
		if ( 0 === $m ) {
			return $s . 's';
		}
		return $m . 'm ' . str_pad( (string) $s, 2, '0', STR_PAD_LEFT ) . 's';
	}
}
