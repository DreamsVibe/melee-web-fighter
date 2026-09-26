// Names and offsets of the data the importer turns into attributes.json and common.json.
// Offsets/names follow the decomp: ftCo_DatAttrs (ft/types.h:754), ftFox_DatAttrs
// (ft/kinds/ftFox/types.h), ftCommonData (ft/types.h:78). 'i' = s32, otherwise f32.

export type Field = [name: string, offset: number, type?: 'i'];

export const ATTRIBUTE_FIELDS: Field[] = [
  ['walk_accel_mul', 0x00], ['walk_accel_base', 0x04], ['walk_max_vel', 0x08], ['slow_walk_max', 0x0c],
  ['mid_walk_point', 0x10], ['fast_walk_min', 0x14], ['ground_friction', 0x18], ['dash_initial_velocity', 0x1c],
  ['dash_accel_mul', 0x20], ['dash_accel_base', 0x24], ['dash_max_velocity', 0x28], ['run_animation_scaling', 0x2c],
  ['max_run_brake_frames', 0x30], ['ground_max_horizontal_velocity', 0x34], ['jump_startup_time', 0x38],
  ['jump_h_initial_velocity', 0x3c], ['jump_v_initial_velocity', 0x40], ['ground_to_air_jump_momentum_multiplier', 0x44],
  ['jump_h_max_velocity', 0x48], ['hop_v_initial_velocity', 0x4c], ['air_jump_v_multiplier', 0x50],
  ['air_jump_h_multiplier', 0x54], ['max_jumps', 0x58, 'i'], ['gravity', 0x5c], ['terminal_velocity', 0x60],
  ['air_drift_stick_mul', 0x64], ['aerial_drift_base', 0x68], ['air_drift_max', 0x6c], ['aerial_friction', 0x70],
  ['fast_fall_velocity', 0x74], ['air_max_horizontal_velocity', 0x78], ['jab_2_input_window', 0x7c],
  ['jab_3_input_window', 0x80], ['standing_turn_frames', 0x84], ['weight', 0x88], ['model_scaling', 0x8c],
  ['initial_shield_size', 0x90], ['shield_break_initial_velocity', 0x94], ['rapid_jab_window', 0x98, 'i'],
  ['clank_animation_length', 0x9c], ['hit_spark_variant', 0xa0, 'i'], ['ledge_jump_horizontal_velocity', 0xa8],
  ['ledge_jump_vertical_velocity', 0xac], ['item_throw_velocity_multiplier', 0xb0], ['heavy_throw_velocity_multiplier', 0xb4],
  ['specials_ground_speed_retention', 0xb8], ['kirby_b_star_damage', 0xe0], ['normal_landing_lag', 0xe4],
  ['landingairn_lag', 0xe8], ['landingairf_lag', 0xec], ['landingairb_lag', 0xf0], ['landingairhi_lag', 0xf4],
  ['landingairlw_lag', 0xf8], ['name_tag_height', 0xfc], ['passivewall_vel_x', 0x100], ['wall_jump_horizontal_velocity', 0x104],
  ['wall_jump_vertical_velocity', 0x108], ['passiveceil_vel_x', 0x10c], ['trophy_scale', 0x110],
  ['screw_attack_launch_velocity', 0x140], ['wall_jump_min_approach_speed', 0x148], ['respawn_platform_scale', 0x160],
];

/** Fox's reflector attributes (ext_attr +0x98..+0xAC). */
export const FOX_SPECIAL_FIELDS: Field[] = [
  ['reflector_release_lag', 0x98], ['reflector_turn_frames', 0x9c], ['reflector_unk_a0', 0xa0],
  ['reflector_gravity_delay', 0xa4, 'i'], ['reflector_momentum_preserve_x', 0xa8], ['reflector_fall_accel', 0xac],
];

/** ftCommonData values the engine reads, by name. */
export const COMMON_FIELDS: Field[] = [
  ['stick_deadzone_x', 0x0], ['stick_deadzone_y', 0x4], ['smash_deadzone_x', 0x8], ['smash_deadzone_y', 0xc],
  ['shoulder_deadzone', 0x10], ['z_analog_value', 0x14], ['shield_press_threshold', 0x18], ['a_after_lr_frames', 0x1c, 'i'],
  ['aerial_angle', 0x20], ['walk_stick_threshold', 0x24], ['walk_middle_threshold', 0x28], ['walk_fast_threshold', 0x2c],
  ['walk_accel_taper', 0x30], ['turn_stick_threshold', 0x34], ['turnrun_stick_threshold', 0x38], ['dash_stick_threshold', 0x3c],
  ['dash_stick_window', 0x40, 'i'], ['dash_iasa_frames_a', 0x44], ['dash_iasa_frames_b', 0x48], ['dash_iasa_frames_c', 0x4c],
  ['dash_reverse_friction', 0x54], ['run_stick_threshold', 0x58], ['run_accel_taper', 0x5c],
  ['run_dash_turn_friction_multiplier', 0x60], ['friction_above_walk_speed', 0x6c], ['tap_jump_threshold', 0x70],
  ['tap_jump_window', 0x74, 'i'], ['jump_back_threshold', 0x78], ['short_hop_release_threshold', 0x7c],
  ['relaxed_tap_jump_threshold', 0x80], ['fast_fall_threshold', 0x88], ['fast_fall_window', 0x8c, 'i'],
  ['squat_threshold', 0x90], ['squat_release_threshold', 0x94], ['aerial_neutral_x', 0xdc], ['aerial_neutral_y', 0xe0],
  ['lcancel_window', 0xe4, 'i'], ['lcancel_divisor', 0xe8], ['aerial_friction_out_of_bounds', 0x1fc],
  ['special_lw_threshold', 0x21c], ['fall_platform_pass_threshold', 0x25c], ['landing_speed_threshold', 0x310],
  ['escapeair_deadzone_x', 0x32c], ['escapeair_deadzone_y', 0x330], ['escapeair_iasa_timer', 0x334, 'i'],
  ['escapeair_force', 0x338], ['escapeair_decay', 0x33c], ['escapeair_fallspecial_mobility', 0x340],
  ['escapeair_landing_lag', 0x344], ['runbrake_anim_speed_threshold', 0x42c], ['run_start_frame_from_turnrun', 0x430],
  ['jump_y_velocity_keep', 0x438], ['walk_anim_speed_ratio', 0x440], ['fall_blend_threshold', 0x444], ['fall_blend_rate', 0x448],
  ['pass_stick_threshold', 0x464], ['pass_stick_window', 0x468], ['pass_y_velocity', 0x46c], ['pass_delay', 0x470],
  ['teeter_walk_threshold', 0x474],
];

export type NamedValues = Record<string, number>;

export function readFields(read: { f32(o: number): number; s32(o: number): number }, base: number, fields: Field[]): NamedValues {
  const out: NamedValues = {};
  for (const [name, off, t] of fields) out[name] = t === 'i' ? read.s32(base + off) : read.f32(base + off);
  return out;
}
