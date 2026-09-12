import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
  type Variants,
} from 'motion/react';

/**
 * Общие параметры движения.
 *
 * Длительности, кривые и наборы состояний заданы здесь один раз: правка
 * «сделать переходы быстрее» не требует обходить компоненты. Значения
 * разложены по смыслу перехода, а не по месту применения.
 */
export const EASE: Transition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] };
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 };

/** Появление блока: лёгкий подъём и проявление. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: EASE },
  gone: { opacity: 0, y: -6, transition: EASE },
};

/** Появление ноды на канвасе: короткое раскрытие из уменьшенного состояния. */
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  shown: { opacity: 1, scale: 1, transition: SPRING },
  gone: { opacity: 0, scale: 0.98, transition: EASE },
};

/**
 * Уважение к системной настройке «меньше движения».
 *
 * Проверка сделана в одном месте: компоненты подставляют пустой набор
 * состояний, поэтому ни один из них не повторяет это условие.
 */
export const useMotionEnabled = (): boolean => useReducedMotion() !== true;

export { AnimatePresence, motion };
