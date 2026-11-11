<?php
/**
 * Storyboards frontend app — inherits active theme styles.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$rest_url  = esc_url_raw( rest_url( 'storyboards/v1' ) );
$nonce     = wp_create_nonce( 'wp_rest' );
$features  = Storyboards_Features::frontend_payload();
$asset_ver = STORYBOARDS_VERSION;

$i18n = array(
	'appTitle'                   => __( 'Storyboards', 'storyboards' ),
	'newBoard'                   => __( 'New board', 'storyboards' ),
	'boardTitle'                 => __( 'Board title', 'storyboards' ),
	'aspectRatio'                => __( 'Aspect ratio', 'storyboards' ),
	'create'                     => __( 'Create', 'storyboards' ),
	'cancel'                     => __( 'Cancel', 'storyboards' ),
	'close'                      => __( 'Close', 'storyboards' ),
	'save'                       => __( 'Save', 'storyboards' ),
	'delete'                     => __( 'Delete', 'storyboards' ),
	'confirmDeleteBoardTitle'    => __( 'Delete storyboard?', 'storyboards' ),
	'confirmDeleteBoardBody'     => __( 'This permanently deletes the board and every scene, photo, and script. This cannot be undone.', 'storyboards' ),
	'confirmDeleteBoardScenes'   => __( '%d scenes will be removed.', 'storyboards' ),
	'confirmDeleteBoardOneScene' => __( '1 scene will be removed.', 'storyboards' ),
	'confirmDeleteCodeLabel'     => __( 'Type this code to confirm', 'storyboards' ),
	'confirmDeleteCodeMismatch'  => __( 'Code does not match.', 'storyboards' ),
	'deleteForever'              => __( 'Delete forever', 'storyboards' ),
	'confirmDeleteScene'         => __( 'Delete this scene?', 'storyboards' ),
	'confirmDiscard'             => __( 'Discard unsaved changes?', 'storyboards' ),
	'noBoards'                   => __( 'No boards yet. Create your first storyboard.', 'storyboards' ),
	'noScenes'                   => __( 'No scenes yet. Add your first shot.', 'storyboards' ),
	'addScene'                   => __( 'Add scene', 'storyboards' ),
	'list'                       => __( 'List', 'storyboards' ),
	'timeline'                   => __( 'Timeline', 'storyboards' ),
	'description'                => __( 'Description', 'storyboards' ),
	'script'                     => __( 'Script', 'storyboards' ),
	'duration'                   => __( 'Duration (sec)', 'storyboards' ),
	'role'                       => __( 'Role', 'storyboards' ),
	'aRoll'                      => __( 'A-Roll', 'storyboards' ),
	'bRoll'                      => __( 'B-Roll', 'storyboards' ),
	'voiceover'                  => __( 'Voiceover', 'storyboards' ),
	'title'                      => __( 'Title', 'storyboards' ),
	'photo'                      => __( 'Photo', 'storyboards' ),
	'addPhoto'                   => __( 'Add photo', 'storyboards' ),
	'changePhoto'                => __( 'Change photo', 'storyboards' ),
	'removePhoto'                => __( 'Remove photo', 'storyboards' ),
	'takePhoto'                  => __( 'Take photo', 'storyboards' ),
	'chooseFromLibrary'          => __( 'Media library', 'storyboards' ),
	'mediaLibraryTitle'          => __( 'Choose scene photo', 'storyboards' ),
	'useSelectedPhoto'           => __( 'Use photo', 'storyboards' ),
	'mediaLibraryUnavailable'    => __( 'Media library is not available.', 'storyboards' ),
	'imagesOnly'                 => __( 'Only photos are allowed (JPEG, PNG, or WebP). Videos cannot be uploaded.', 'storyboards' ),
	'generateDesc'               => __( 'Generate description', 'storyboards' ),
	'generateScript'             => __( 'Generate script', 'storyboards' ),
	'generateImage'              => __( 'Generate image', 'storyboards' ),
	'back'                       => __( 'Back', 'storyboards' ),
	'total'                      => __( 'Total', 'storyboards' ),
	'scenes'                     => __( 'scenes', 'storyboards' ),
	'sceneOne'                   => __( '1 scene', 'storyboards' ),
	'scenesCount'                => __( '%d scenes', 'storyboards' ),
	'defaultDuration'            => __( 'default', 'storyboards' ),
	'compressing'                => __( 'Compressing image…', 'storyboards' ),
	'uploading'                  => __( 'Uploading…', 'storyboards' ),
	'errorGeneric'               => __( 'Something went wrong. Please try again.', 'storyboards' ),
	'laneA'                      => __( 'A', 'storyboards' ),
	'laneB'                      => __( 'B', 'storyboards' ),
	'laneVO'                     => __( 'VO', 'storyboards' ),
	'previousScene'              => __( 'Previous scene', 'storyboards' ),
	'nextScene'                  => __( 'Next scene', 'storyboards' ),
	'scenePosition'              => __( '%1$d / %2$d', 'storyboards' ),
	'swipeScenes'                => __( 'Swipe for previous or next scene', 'storyboards' ),
	'saving'                     => __( 'Saving…', 'storyboards' ),
	'publicBoard'                => __( 'Public link', 'storyboards' ),
	'makePublic'                 => __( 'Make public', 'storyboards' ),
	'makePrivate'                => __( 'Make private', 'storyboards' ),
	'publicHint'                 => __( 'Anyone with the link can view this board (read-only).', 'storyboards' ),
	'copyLink'                   => __( 'Copy link', 'storyboards' ),
	'linkCopied'                 => __( 'Link copied', 'storyboards' ),
	'viewOnly'                   => __( 'View only', 'storyboards' ),
);

?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="robots" content="noindex, nofollow">
	<meta name="googlebot" content="noindex, nofollow">
	<meta name="theme-color" content="#ffffff">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<title><?php echo esc_html__( 'Storyboards', 'storyboards' ); ?></title>
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'sb-app' ); ?>>
<?php wp_body_open(); ?>
	<div class="sb-shell">
		<div id="sb-root"></div>
	</div>
	<script>
		window.StoryboardsConfig = <?php
		echo wp_json_encode(
			array(
				'restUrl'               => $rest_url,
				'nonce'                 => $nonce,
				'homeUrl'               => home_url( '/' ),
				'appBase'               => Storyboards_Rewrite::app_url(),
				'initialBoardSlug'      => Storyboards_Rewrite::requested_board_slug(),
				'canManage'             => Storyboards_Rewrite::can_manage(),
				'features'              => $features,
				'i18n'                  => $i18n,
			)
		);
		?>;
	</script>
	<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js" defer></script>
	<script type="module" src="<?php echo esc_url( STORYBOARDS_URL . 'assets/js/app.js?v=' . rawurlencode( $asset_ver ) ); ?>"></script>
	<?php wp_footer(); ?>
</body>
</html>
