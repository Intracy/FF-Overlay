// Animationsnamen kompatibel zu Animate.css (v4). Gruppen wie in Streamlabs, damit Designs austauschbar bleiben.

export const IN_ANIMATIONS: Record<string, string[]> = {
  Fade: ['fadeIn', 'fadeInDown', 'fadeInDownBig', 'fadeInLeft', 'fadeInLeftBig', 'fadeInRight', 'fadeInRightBig', 'fadeInUp', 'fadeInUpBig'],
  Zoom: ['zoomIn', 'zoomInDown', 'zoomInLeft', 'zoomInRight', 'zoomInUp'],
  Bounce: ['bounceIn', 'bounceInDown', 'bounceInLeft', 'bounceInRight', 'bounceInUp'],
  Slide: ['slideInUp', 'slideInDown', 'slideInLeft', 'slideInRight'],
  Flip: ['flipInX', 'flipInY'],
  Rotate: ['rotateIn', 'rotateInDownLeft', 'rotateInDownRight', 'rotateInUpLeft', 'rotateInUpRight'],
  Specials: ['lightSpeedInRight', 'lightSpeedInLeft', 'rollIn', 'jackInTheBox', 'backInDown', 'backInUp', 'flash', 'pulse', 'rubberBand', 'shakeX', 'swing', 'tada', 'wobble', 'jello', 'heartBeat'],
};

export const OUT_ANIMATIONS: Record<string, string[]> = {
  Fade: ['fadeOut', 'fadeOutDown', 'fadeOutDownBig', 'fadeOutLeft', 'fadeOutLeftBig', 'fadeOutRight', 'fadeOutRightBig', 'fadeOutUp', 'fadeOutUpBig'],
  Zoom: ['zoomOut', 'zoomOutDown', 'zoomOutLeft', 'zoomOutRight', 'zoomOutUp'],
  Bounce: ['bounceOut', 'bounceOutDown', 'bounceOutLeft', 'bounceOutRight', 'bounceOutUp'],
  Slide: ['slideOutUp', 'slideOutDown', 'slideOutLeft', 'slideOutRight'],
  Flip: ['flipOutX', 'flipOutY'],
  Rotate: ['rotateOut', 'rotateOutDownLeft', 'rotateOutDownRight', 'rotateOutUpLeft', 'rotateOutUpRight'],
  Specials: ['lightSpeedOutRight', 'lightSpeedOutLeft', 'rollOut', 'backOutDown', 'backOutUp', 'hinge'],
};

/** Dauer-Animationen pro Buchstabe (wie Streamlabs „Text Animation“) */
export const LETTER_ANIMATIONS = ['none', 'wave', 'bounce', 'pulse', 'rubberBand', 'tada', 'wiggle', 'wobble'] as const;

export const LETTER_LABEL: Record<string, string> = {
  none: 'Keine', wave: 'Welle', bounce: 'Hüpfen', pulse: 'Pulsieren', rubberBand: 'Gummiband', tada: 'Tada', wiggle: 'Wackeln', wobble: 'Schwanken',
};
