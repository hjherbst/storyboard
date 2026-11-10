<?php
/**
 * Full-viewport Storyboards frontend app.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$rest_url = esc_url_raw( rest_url( 'storyboards/v1' ) );
$nonce    = wp_create_nonce( 'wp_rest' );
$features = Storyboards_Features::frontend_payload();
$asset_ver = STORYBOARDS_VERSION;
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="theme-color" content="#1a1f24">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<title><?php echo esc_html__( 'Storyboards', 'storyboards' ); ?></title>
	<link rel="stylesheet" href="<?php echo esc_url( STORYBOARDS_URL . 'assets/css/app.css?v=' . $asset_ver ); ?>">
	<script>
		window.StoryboardsConfig = <?php
		echo wp_json_encode(
			array(
				'restUrl'  => $rest_url,
				'nonce'    => $nonce,
				'homeUrl'  => home_url( '/' ),
				'features' => $features,
				'i18n'     => array(
					'appTitle'        => __( 'Storyboards', 'storyboards' ),
					'newBoard'        => __( 'New board', 'storyboards' ),
					'boardTitle'      => __( 'Board title', 'storyboards' ),
					'aspectRatio'     => __( 'Aspect ratio', 'storyboards' ),
					'create'          => __( 'Create', 'storyboards' ),
					'cancel'          => __( 'Cancel', 'storyboards' ),
					'close'           => __( 'Close', 'storyboards' ),
					'save'            => __( 'Save', 'storyboards' ),
					'delete'          => __( 'Delete', 'storyboards' ),
					'confirmDeleteBoard' => __( 'Delete this board and all scenes?', 'storyboards' ),
					'confirmDeleteScene' => __( 'Delete this scene?', 'storyboards' ),
					'confirmDiscard'  => __( 'Discard unsaved changes?', 'storyboards' ),
					'noBoards'        => __( 'No boards yet. Create your first storyboard.', 'storyboards' ),
					'noScenes'        => __( 'No scenes yet. Add your first shot.', 'storyboards' ),
					'addScene'        => __( 'Add scene', 'storyboards' ),
					'list'            => __( 'List', 'storyboards' ),
					'timeline'        => __( 'Timeline', 'storyboards' ),
					'description'     => __( 'Description', 'storyboards' ),
					'script'          => __( 'Script', 'storyboards' ),
					'duration'        => __( 'Duration (sec)', 'storyboards' ),
					'role'            => __( 'Role', 'storyboards' ),
					'aRoll'           => __( 'A-Roll', 'storyboards' ),
					'bRoll'           => __( 'B-Roll', 'storyboards' ),
					'voiceover'       => __( 'Voiceover', 'storyboards' ),
					'title'           => __( 'Title', 'storyboards' ),
					'photo'           => __( 'Photo', 'storyboards' ),
					'addPhoto'        => __( 'Add photo', 'storyboards' ),
					'changePhoto'     => __( 'Change photo', 'storyboards' ),
					'removePhoto'     => __( 'Remove photo', 'storyboards' ),
					'generateDesc'    => __( 'Generate description', 'storyboards' ),
					'generateScript'  => __( 'Generate script', 'storyboards' ),
					'generateImage'   => __( 'Generate image', 'storyboards' ),
					'back'            => __( 'Back', 'storyboards' ),
					'total'           => __( 'Total', 'storyboards' ),
					'defaultDuration' => __( 'default', 'storyboards' ),
					'compressing'     => __( 'Compressing image…', 'storyboards' ),
					'uploading'       => __( 'Uploading…', 'storyboards' ),
					'errorGeneric'    => __( 'Something went wrong. Please try again.', 'storyboards' ),
					'laneA'           => __( 'A', 'storyboards' ),
					'laneB'           => __( 'B', 'storyboards' ),
					'laneVO'          => __( 'VO', 'storyboards' ),
				),
			)
		);
		?>;
	</script>
</head>
<body class="sb-app">
	<div id="sb-root"></div>
	<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js" defer></script>
	<script type="module" src="<?php echo esc_url( STORYBOARDS_URL . 'assets/js/app.js?v=' . $asset_ver ); ?>"></script>
</body>
</html>
