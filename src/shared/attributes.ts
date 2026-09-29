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

/** Fox's special-move attributes (ftFox_DatAttrs, ext_attr +0x00..+0xAC). */
export const FOX_SPECIAL_FIELDS: Field[] = [
  ['blaster_unk_00', 0x00], ['blaster_unk_04', 0x04], ['blaster_unk_08', 0x08], ['blaster_unk_0c', 0x0c],
  ['blaster_angle', 0x10], ['blaster_velocity', 0x14], ['blaster_landing_lag', 0x18],
  ['illusion_gravity_delay', 0x24], ['illusion_ground_vel_div', 0x28], ['illusion_start_air_friction', 0x2c],
  ['illusion_start_fall_accel', 0x30], ['illusion_ground_end_vel_x', 0x34], ['illusion_ground_end_friction', 0x38],
  ['illusion_air_end_vel_x', 0x3c], ['illusion_air_end_friction', 0x40], ['illusion_end_gravity_delay', 0x44],
  ['illusion_end_fall_accel', 0x48], ['illusion_freefall_mobility', 0x4c], ['illusion_landing_lag', 0x50],
  ['firefox_gravity_delay', 0x54], ['firefox_vel_div', 0x58], ['firefox_hold_air_friction', 0x5c],
  ['firefox_hold_fall_accel', 0x60], ['firefox_direction_stick_min', 0x64], ['firefox_duration', 0x68],
  ['firefox_bounce_frames', 0x6c, 'i'], ['firefox_decel_start', 0x70], ['firefox_speed', 0x74],
  ['firefox_decel', 0x78], ['firefox_landing_friction', 0x7c], ['firefox_unk_80', 0x80],
  ['firefox_bound_vel_x', 0x84], ['firefox_facing_stick_min', 0x88], ['firefox_freefall_mobility', 0x8c],
  ['firefox_landing_lag', 0x90], ['firefox_bound_angle', 0x94],
  ['reflector_release_lag', 0x98], ['reflector_turn_frames', 0x9c], ['reflector_unk_a0', 0xa0],
  ['reflector_gravity_delay', 0xa4, 'i'], ['reflector_momentum_preserve_x', 0xa8], ['reflector_fall_accel', 0xac],
  // ReflectDesc at +0xB0: the reflector bubble's bone, offset and size.
  ['reflector_bone', 0xb0, 'i'], ['reflector_offset_x', 0xb8], ['reflector_offset_y', 0xbc], ['reflector_offset_z', 0xc0],
  ['reflector_size', 0xc4],
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
  // Ground attacks (ftCo_Attack*_CheckInput), specials, shield, rolls and grabs.
  ['dash_attack_friction_mul', 0x50], ['catch_friction_mul', 0x64], ['dash_grab_window', 0x68], ['ftilt_stick_threshold', 0x98],
  ['ftilt_angle_hi', 0x9c], ['ftilt_angle_his', 0xa0], ['ftilt_angle_lws', 0xa4], ['ftilt_angle_lw', 0xa8],
  ['utilt_stick_threshold', 0xac], ['dtilt_stick_threshold', 0xb0], ['fsmash_angle_hi', 0xb8],
  ['fsmash_angle_his', 0xbc], ['fsmash_angle_lws', 0xc0], ['fsmash_angle_lw', 0xc4], ['usmash_stick_threshold', 0xcc],
  ['usmash_stick_window', 0xd0], ['dsmash_stick_threshold', 0xd4], ['dsmash_stick_window', 0xd8],
  ['special_s_threshold', 0x218], ['special_s_turn_threshold', 0x220], ['special_n_turn_window', 0x224, 'i'],
  ['powershield_input_window', 0x2a0, 'i'], ['shield_start_health', 0x260], ['shield_min_size', 0x264], ['shield_min_hold_frames', 0x268],
  ['shield_decay', 0x278], ['shield_regen', 0x27c], ['shield_size_light', 0x2d4], ['shield_size_full', 0x2d8],
  ['shield_decay_light', 0x2ec], ['shield_decay_full', 0x2f0], ['shield_alpha_min', 0x2f4],
  ['spotdodge_stick_threshold', 0x314], ['spotdodge_stick_window', 0x318, 'i'], ['roll_stick_threshold', 0x31c],
  ['roll_stick_window', 0x320, 'i'], ['roll_arg', 0x324, 'i'], ['run_shield_lag', 0x410, 'i'],
  ['smash_charge_sound_frame', 0x7c8],
  // Hits and knockback (ft/ftcoll.c, ftCo_Damage.c, ftCo_DownBound.c, fighter.c procUpdate/procCollResolve).
  ['kb_weight_scale', 0xf4], ['kb_weight_base', 0xf8], ['kb_vel_merge_frames', 0xfc, 'i'], ['kb_launch_speed', 0x100],
  ['kb_min', 0x104], ['kb_max', 0x108], ['kb_percent_mul', 0x110], ['kb_damage_mul', 0x114], ['kb_set_damage', 0x118],
  ['kb_scale', 0x11c], ['kb_add', 0x120], ['kb_squat_mul', 0x124], ['kb_collide_threshold', 0x12c], ['kb_collide_frames', 0x130, 'i'],
  ['kb_rehit_margin', 0x140], ['sakurai_air_angle', 0x144], ['sakurai_ground_angle', 0x148], ['sakurai_ground_kb_min', 0x14c],
  ['sakurai_ground_kb_max', 0x150], ['hitstun_mul', 0x154], ['kb_level_1', 0x158], ['kb_level_2', 0x15c], ['kb_level_3', 0x160],
  ['max_grounded_kb_on_landing', 0x164], ['hitlag_shake_mul', 0x168], ['hitlag_shake_add', 0x16c],
  ['air_motion_frames', 0x18c, 'i'], ['air_motion_kb_mul', 0x190], ['hitlag_max', 0x194], ['hitlag_damage_mul', 0x198],
  ['hitlag_add', 0x19c], ['hitlag_crouch_mul', 0x1a0], ['hitlag_electric_mul', 0x1a4], ['tech_window', 0x1d0], ['damage_land_down_speed', 0x1e0],
  ['damage_land_speed', 0x1e4], ['ground_bounce_angle', 0x1e8], ['ground_bounce_mul', 0x1ec], ['down_bound_sfx_1', 0x1f0],
  ['down_bound_sfx_2', 0x1f4], ['ground_kb_friction_mul', 0x200], ['kb_decay', 0x204], ['fly_sfx_2', 0x208], ['fly_sfx_1', 0x20c],
  ['damagefall_drift_threshold', 0x210], ['damagefall_drift_window', 0x214, 'i'], ['fly_top_angle_min', 0x234],
  ['fly_top_angle_max', 0x238], ['fly_roll_percent', 0x23c, 'i'], ['fly_roll_chance', 0x240], ['down_wait_frames', 0x424],
  ['push_speed', 0x450], ['phantom_threshold', 0x7a8], ['hit_effect_big_kb', 0x3f0],
  // Ledges (ft/ftcliffcommon.c, ftCo_Cliff*.c, ft/ft_081B.c).
  ['cliff_grab_stick_threshold', 0x480], ['cliff_slow_percent', 0x488, 'i'], ['cliff_wait_frames', 0x48c],
  ['cliff_wait_frames_slow', 0x490], ['cliff_climb_stick_threshold', 0x494], ['ledge_cooldown', 0x498, 'i'],
  ['cliff_intangible_frames', 0x49c, 'i'], ['cliff_attack_cstick_threshold', 0x7f8], ['cliff_escape_cstick_threshold', 0x7fc],
];

/** Sandbag's own attributes (ext_attr: its knockback deceleration, ftCommon_SandbagGetKnockbackDeaccelX/Y). */
export const SANDBAG_SPECIAL_FIELDS: Field[] = [['kb_decel_x', 0x0], ['kb_decel_y', 0x4]];

export type NamedValues = Record<string, number>;

export function readFields(read: { f32(o: number): number; s32(o: number): number }, base: number, fields: Field[]): NamedValues {
  const out: NamedValues = {};
  for (const [name, off, t] of fields) out[name] = t === 'i' ? read.s32(base + off) : read.f32(base + off);
  return out;
}
