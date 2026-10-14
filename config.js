// All gameplay tuning lives here. Speeds and geometry use the 360 × 640 world.
export const CONFIG = {
  logical_width: 360, logical_height: 640,
  game_duration_s: 45, final_cleanup_s: 5, npc_initial_grace_s: 3,
  cat_max_speed_px_s: 118, librarian_walk_speed_ratio: .9, librarian_run_speed_ratio: 1.8,
  joystick_deadzone_px: 8, joystick_max_drag_px: 54,
  npc_run_duration_s: [1, 2], npc_run_cooldown_s: [4, 7], npc_run_prepare_s: .24,
  npc_turn_interval_s: [1.2, 2.8], npc_shake_duration_s: .8,
  npc_shake_cooldown_s: [6, 9], npc_shake_spawn_at_s: .4,
  npc_shake_stain_count: [4, 6], npc_shake_radius_px: 42,
  npc_stretch_duration_s: 1.2, npc_stretch_cooldown_s: [8, 12],
  footstep_distance_px: 38, footprint_width_px: 13, footprint_length_px: 25,
  max_active_stains: 180, cat_idle_start_s: 3, cat_idle_repeat_s: 6,
  special_button_label: '와다다 청소!', special_charge_max: 100,
  special_charge_per_normal_stain: 10, special_charge_per_special_stain: 0,
  special_duration_s: 2.2, special_range_multiplier: 2.3, special_speed_multiplier: 1,
  grade_a_ratio: .9, grade_b_ratio: .7, clear_ratio: .7, next_step_url: '', debug: false,
  story_return_url:'https://gamemakercho.github.io/cat-librarian/',
  cat_scale: .155, librarian_scale: .18, cat_body_radius: 10,
  mop_half_width: 13, mop_half_depth: 5.5, cat_turn_speed: 13,
  npc_radius: 13, npc_navigation_radius: 27, navigation_cell_px: 8,
  simulation_step_s: 1 / 120, countdown_s: 3, erase_duration_s: .36,
};

// Measured against the final background; rectangles are [x, y, width, height].
// The lower bookcases separate this room from the decorative foreground.
export const MAP_CONFIG = {
  bounds: [18, 130, 324, 370],
  obstacles: [
    { name: '왼쪽 독서 코너', rect: [18, 130, 88, 34] },
    { name: '왼쪽 위 서가', rect: [0, 143, 29, 61] },
    { name: '왼쪽 가운데 서가', rect: [0, 228, 29, 97] },
    { name: '왼쪽 아래 서가', rect: [0, 354, 25, 110] },
    { name: '오른쪽 위 서가', rect: [321, 130, 39, 65] },
    { name: '오른쪽 가운데 서가', rect: [332, 194, 28, 127] },
    { name: '오른쪽 아래 서가', rect: [336, 355, 24, 109] },
  ],
  cat_spawn: [180, 362], npc_spawn: [180, 294],
  background: { width: 941, height: 1672 },
};
