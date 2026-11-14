// src/ui/components.js
import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ActivityIndicator, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icons';
import { colors, fonts, radius, type, MIN_TOUCH } from './theme';

export function Button({ label, onPress, variant = 'primary', icon, iconRight, loading, disabled, style, accessibilityLabel, accessibilityHint }) {
  const primary = variant === 'primary';
  const fg = primary ? colors.white : colors.ink;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={[styles.btn, primary ? styles.btnPrimary : styles.btnOutline, (disabled && !loading) && { opacity: 0.45 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Icon name={icon} size={20} color={fg} strokeWidth={2.4} /> : null}
          <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
          {iconRight ? <Icon name={iconRight} size={20} color={fg} strokeWidth={2.2} /> : null}
        </>
      )}
    </TouchableOpacity>
  );
}

export function TextLink({ label, onPress, accessibilityLabel, style, textStyle }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} style={[{ minHeight: MIN_TOUCH, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }, style]}>
      <Text style={[{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink, textDecorationLine: 'underline' }, textStyle]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function IconButton({ name, onPress, label, bg = colors.white, color = colors.ink, size = 48, iconSize = 22, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Icon name={name} size={iconSize} color={color} />
    </TouchableOpacity>
  );
}

export function Chip({ label, selected, onPress, role = 'button', icon }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole={role === 'checkbox' ? 'checkbox' : 'tab'}
      accessibilityState={role === 'checkbox' ? { checked: !!selected } : { selected: !!selected }}
      style={[styles.chip, selected ? styles.chipOn : styles.chipOff]}
    >
      {selected && role === 'checkbox' ? <Icon name="check" size={16} color={colors.white} strokeWidth={2.6} /> : null}
      {icon}
      <Text style={[styles.chipText, { color: selected && role === 'checkbox' ? colors.white : colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Filter chips (Global / Following etc.)
export function ScopeChips({ options, value, onChange }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {options.map(o => (
        <TouchableOpacity
          key={o.key}
          onPress={() => onChange(o.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === o.key }}
          style={[styles.scope, value === o.key ? { borderColor: colors.ink, backgroundColor: colors.mint } : { borderColor: '#C9D3CC', backgroundColor: colors.white }]}
        >
          <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.ink }}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <View accessibilityRole="tablist" style={styles.segment}>
      {options.map(o => {
        const on = value === o.key;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segBtn, on && { backgroundColor: colors.ink }]}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: on ? colors.white : colors.ink }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, label, track = colors.white, height = 8 }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}
    >
      <View style={{ width: `${Math.round(value * 100)}%`, height: '100%', backgroundColor: colors.ink, borderRadius: height / 2 }} />
    </View>
  );
}

// Bottom sheet built on Modal. Tapping the dim area or the Android back button closes it.
export function Sheet({ visible, onClose, children, labelledBy, scroll = false }) {
  const insets = useSafeAreaInsets();
  const Body = scroll ? ScrollView : View;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View accessibilityViewIsModal accessibilityLabel={labelledBy} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <View style={styles.grabber} accessible={false} />
          <Body style={scroll ? { maxHeight: 620 } : null} contentContainerStyle={scroll ? { gap: 12 } : undefined}>
            {scroll ? children : <View style={{ gap: 12 }}>{children}</View>}
          </Body>
        </View>
      </View>
    </Modal>
  );
}

export function Notice({ icon = 'lock', children, bg = colors.cream }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: bg, borderRadius: radius.sm, padding: 12 }}>
      <Icon name={icon} size={18} />
      <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink }}>{children}</Text>
    </View>
  );
}

export function Field({ label, optional, children, hint }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>
        {label}{optional ? <Text style={{ fontFamily: fonts.medium, color: colors.muted }}> (optional)</Text> : null}
      </Text>
      {children}
      {hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
}

export const inputStyle = {
  minHeight: 54,
  borderRadius: radius.sm,
  borderWidth: 1.5,
  borderColor: colors.lineStrong,
  backgroundColor: colors.white,
  paddingHorizontal: 16,
  fontFamily: fonts.body,
  fontSize: 16,
  color: colors.ink,
};

const styles = StyleSheet.create({
  btn: { minHeight: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 22 },
  btnPrimary: { backgroundColor: colors.ink },
  btnOutline: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink },
  btnText: { fontFamily: fonts.bold, fontSize: 17 },
  chip: { minHeight: 46, paddingHorizontal: 16, borderRadius: 23, borderWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipOn: { backgroundColor: colors.ink },
  chipOff: { backgroundColor: colors.white },
  chipText: { fontFamily: fonts.bold, fontSize: 15 },
  scope: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1.5, justifyContent: 'center' },
  segment: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 26, padding: 4, borderWidth: 1.5, borderColor: colors.line },
  segBtn: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: 20, paddingTop: 12 },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#C9D3CC', alignSelf: 'center', marginBottom: 10 },
});
