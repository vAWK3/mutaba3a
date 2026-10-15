import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Mutaba3a bloom loader — 4.5s loop: petals gather into drops, swirl and merge,
/// then split and bloom back into the mark. No dependencies; respects reduce-motion.
/// Usage: const Mutaba3aLoader(size: 56)
class Mutaba3aLoader extends StatefulWidget {
  const Mutaba3aLoader({super.key, this.size = 56});
  final double size;
  @override
  State<Mutaba3aLoader> createState() => _Mutaba3aLoaderState();
}

class _Mutaba3aLoaderState extends State<Mutaba3aLoader> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 4500))..repeat();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final still = MediaQuery.of(context).disableAnimations;
    return Semantics(label: 'Loading', child: SizedBox.square(dimension: widget.size,
      child: still ? CustomPaint(painter: _BloomPainter(0, dark))
        : AnimatedBuilder(animation: _c, builder: (_, __) => CustomPaint(painter: _BloomPainter(_c.value * 270, dark)))));
  }
}

class _K { const _K(this.t, this.s, this.e); final double t; final List<double> s; final Curve e; }
class _R { const _R(this.t, this.r, this.e); final double t; final double r; final Curve e; }

// Per piece (top-right, top-left, bottom-left, bottom-right): frame @60fps,
// 4 vertices × [x, y, inX, inY, outX, outY] in a 100×100 box, easing to next key.
const _keys = <List<_K>>[
    [
      _K(0, [76, 2, -12.15, 0, 12.15, 0, 98, 24, 0, -12.15, 0, 12.15, 76, 46, 12.15, 0, -12.15, 0, 54, 24, 0, 12.15, 0, -12.15], Cubic(0, 0, 1, 1)),
      _K(36, [76, 2, -12.15, 0, 12.15, 0, 98, 24, 0, -12.15, 0, 12.15, 76, 46, 12.15, 0, -12.15, 0, 54, 24, 0, 12.15, 0, -12.15], Cubic(0.45, 0, 0.3, 1)),
      _K(84, [67, 21, -6.63, 0, 6.63, 0, 79, 33, 0, -6.63, 0, 6.63, 67, 45, 6.63, 0, -6.63, 0, 55, 33, 0, 6.63, 0, -6.63], Cubic(0.42, 0, 0.58, 1)),
      _K(126, [55, 30, -8.28, 0, 8.28, 0, 70, 45, 0, -8.28, 0, 8.28, 55, 60, 8.28, 0, -8.28, 0, 40, 45, 0, 8.28, 0, -8.28], Cubic(0.42, 0, 0.58, 1)),
      _K(150, [54, 32, -7.73, 0, 7.73, 0, 68, 46, 0, -7.73, 0, 7.73, 54, 60, 7.73, 0, -7.73, 0, 40, 46, 0, 7.73, 0, -7.73], Cubic(0.35, 0, 0.3, 1)),
      _K(190, [70, 17.5, -6.9, 0, 6.9, 0, 82.5, 30, 0, -6.9, 0, 6.9, 70, 42.5, 6.9, 0, -6.9, 0, 57.5, 30, 0, 6.9, 0, -6.9], Cubic(0.3, 0, 0.2, 1.04)),
      _K(236, [76, 2, -12.15, 0, 12.15, 0, 98, 24, 0, -12.15, 0, 12.15, 76, 46, 12.15, 0, -12.15, 0, 54, 24, 0, 12.15, 0, -12.15], Cubic(0, 0, 1, 1)),
      _K(270, [76, 2, -12.15, 0, 12.15, 0, 98, 24, 0, -12.15, 0, 12.15, 76, 46, 12.15, 0, -12.15, 0, 54, 24, 0, 12.15, 0, -12.15], Cubic(0, 0, 1, 1)),
    ],
    [
      _K(0, [14.89, 14.89, -8.25, 8.25, 8.25, -8.25, 46, 2, -11.67, 0, 0, 0, 46, 46, 0, 0, 0, 0, 2, 46, 0, 0, 0, -11.67], Cubic(0, 0, 1, 1)),
      _K(40, [14.89, 14.89, -8.25, 8.25, 8.25, -8.25, 46, 2, -11.67, 0, 0, 0, 46, 46, 0, 0, 0, 0, 2, 46, 0, 0, 0, -11.67], Cubic(0.45, 0, 0.3, 1)),
      _K(88, [33, 21, -6.63, 0, 6.63, 0, 45, 33, 0, -6.63, 0, 6.63, 33, 45, 6.63, 0, -6.63, 0, 21, 33, 0, 6.63, 0, -6.63], Cubic(0.42, 0, 0.58, 1)),
      _K(130, [45, 30, -8.28, 0, 8.28, 0, 60, 45, 0, -8.28, 0, 8.28, 45, 60, 8.28, 0, -8.28, 0, 30, 45, 0, 8.28, 0, -8.28], Cubic(0.42, 0, 0.58, 1)),
      _K(154, [46, 32, -7.73, 0, 7.73, 0, 60, 46, 0, -7.73, 0, 7.73, 46, 60, 7.73, 0, -7.73, 0, 32, 46, 0, 7.73, 0, -7.73], Cubic(0.35, 0, 0.3, 1)),
      _K(194, [30, 17.5, -6.9, 0, 6.9, 0, 42.5, 30, 0, -6.9, 0, 6.9, 30, 42.5, 6.9, 0, -6.9, 0, 17.5, 30, 0, 6.9, 0, -6.9], Cubic(0.3, 0, 0.2, 1.04)),
      _K(240, [14.89, 14.89, -8.25, 8.25, 8.25, -8.25, 46, 2, -11.67, 0, 0, 0, 46, 46, 0, 0, 0, 0, 2, 46, 0, 0, 0, -11.67], Cubic(0, 0, 1, 1)),
      _K(270, [14.89, 14.89, -8.25, 8.25, 8.25, -8.25, 46, 2, -11.67, 0, 0, 0, 46, 46, 0, 0, 0, 0, 2, 46, 0, 0, 0, -11.67], Cubic(0, 0, 1, 1)),
    ],
    [
      _K(0, [14.89, 66.89, -8.25, 8.25, 8.25, -8.25, 46, 54, -11.67, 0, 0, 11.67, 33.11, 85.11, 8.25, -8.25, -8.25, 8.25, 2, 98, 11.67, 0, 0, -11.67], Cubic(0, 0, 1, 1)),
      _K(44, [14.89, 66.89, -8.25, 8.25, 8.25, -8.25, 46, 54, -11.67, 0, 0, 11.67, 33.11, 85.11, 8.25, -8.25, -8.25, 8.25, 2, 98, 11.67, 0, 0, -11.67], Cubic(0.45, 0, 0.3, 1)),
      _K(92, [33, 55, -6.63, 0, 6.63, 0, 45, 67, 0, -6.63, 0, 6.63, 33, 79, 6.63, 0, -6.63, 0, 21, 67, 0, 6.63, 0, -6.63], Cubic(0.42, 0, 0.58, 1)),
      _K(134, [45, 40, -8.28, 0, 8.28, 0, 60, 55, 0, -8.28, 0, 8.28, 45, 70, 8.28, 0, -8.28, 0, 30, 55, 0, 8.28, 0, -8.28], Cubic(0.42, 0, 0.58, 1)),
      _K(158, [46, 40, -7.73, 0, 7.73, 0, 60, 54, 0, -7.73, 0, 7.73, 46, 68, 7.73, 0, -7.73, 0, 32, 54, 0, 7.73, 0, -7.73], Cubic(0.35, 0, 0.3, 1)),
      _K(198, [30, 57.5, -6.9, 0, 6.9, 0, 42.5, 70, 0, -6.9, 0, 6.9, 30, 82.5, 6.9, 0, -6.9, 0, 17.5, 70, 0, 6.9, 0, -6.9], Cubic(0.3, 0, 0.2, 1.04)),
      _K(244, [14.89, 66.89, -8.25, 8.25, 8.25, -8.25, 46, 54, -11.67, 0, 0, 11.67, 33.11, 85.11, 8.25, -8.25, -8.25, 8.25, 2, 98, 11.67, 0, 0, -11.67], Cubic(0, 0, 1, 1)),
      _K(270, [14.89, 66.89, -8.25, 8.25, 8.25, -8.25, 46, 54, -11.67, 0, 0, 11.67, 33.11, 85.11, 8.25, -8.25, -8.25, 8.25, 2, 98, 11.67, 0, 0, -11.67], Cubic(0, 0, 1, 1)),
    ],
    [
      _K(0, [54, 54, 0, 0, 0, 0, 98, 54, 0, 0, 0, 11.67, 85.11, 85.11, 8.25, -8.25, -8.25, 8.25, 54, 98, 11.67, 0, 0, 0], Cubic(0, 0, 1, 1)),
      _K(48, [54, 54, 0, 0, 0, 0, 98, 54, 0, 0, 0, 11.67, 85.11, 85.11, 8.25, -8.25, -8.25, 8.25, 54, 98, 11.67, 0, 0, 0], Cubic(0.45, 0, 0.3, 1)),
      _K(96, [67, 55, -6.63, 0, 6.63, 0, 79, 67, 0, -6.63, 0, 6.63, 67, 79, 6.63, 0, -6.63, 0, 55, 67, 0, 6.63, 0, -6.63], Cubic(0.42, 0, 0.58, 1)),
      _K(138, [55, 40, -8.28, 0, 8.28, 0, 70, 55, 0, -8.28, 0, 8.28, 55, 70, 8.28, 0, -8.28, 0, 40, 55, 0, 8.28, 0, -8.28], Cubic(0.42, 0, 0.58, 1)),
      _K(162, [54, 40, -7.73, 0, 7.73, 0, 68, 54, 0, -7.73, 0, 7.73, 54, 68, 7.73, 0, -7.73, 0, 40, 54, 0, 7.73, 0, -7.73], Cubic(0.35, 0, 0.3, 1)),
      _K(202, [70, 57.5, -6.9, 0, 6.9, 0, 82.5, 70, 0, -6.9, 0, 6.9, 70, 82.5, 6.9, 0, -6.9, 0, 57.5, 70, 0, 6.9, 0, -6.9], Cubic(0.3, 0, 0.2, 1.04)),
      _K(248, [54, 54, 0, 0, 0, 0, 98, 54, 0, 0, 0, 11.67, 85.11, 85.11, 8.25, -8.25, -8.25, 8.25, 54, 98, 11.67, 0, 0, 0], Cubic(0, 0, 1, 1)),
      _K(270, [54, 54, 0, 0, 0, 0, 98, 54, 0, 0, 0, 11.67, 85.11, 85.11, 8.25, -8.25, -8.25, 8.25, 54, 98, 11.67, 0, 0, 0], Cubic(0, 0, 1, 1)),
    ],
];
const _rot = <_R>[
  _R(0, 0, Cubic(0, 0, 1, 1)),
  _R(36, 0, Cubic(0.45, 0, 0.4, 1)),
  _R(220, 360, Cubic(0, 0, 1, 1)),
  _R(270, 360, Cubic(0, 0, 1, 1)),
];

class _BloomPainter extends CustomPainter {
  _BloomPainter(this.f, this.dark);
  final double f; final bool dark;

  static List<double> _shape(List<_K> ks, double f) {
    for (var j = 0; j < ks.length - 1; j++) {
      final a = ks[j], b = ks[j + 1];
      if (f < b.t) {
        final p = a.e.transform(((f - a.t) / (b.t - a.t)).clamp(0.0, 1.0));
        return List.generate(a.s.length, (n) => a.s[n] + (b.s[n] - a.s[n]) * p);
      }
    }
    return ks.last.s;
  }

  static double _angle(double f) {
    for (var j = 0; j < _rot.length - 1; j++) {
      final a = _rot[j], b = _rot[j + 1];
      if (f < b.t) return a.r + (b.r - a.r) * a.e.transform(((f - a.t) / (b.t - a.t)).clamp(0.0, 1.0));
    }
    return 0;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final colors = dark
      ? const [Color(0xFFF3E5B0), Color(0xFFBCABF1), Color(0xFFF499A7), Color(0xFFF9B379)]
      : const [Color(0xFF795DBA), Color(0xFFBCABF1), Color(0xFFF499A7), Color(0xFFF5AB77)];
    canvas..save()..scale(size.width / 120)..translate(60, 60)..rotate(_angle(f) * math.pi / 180)..translate(-50, -50);
    for (var i = 0; i < 4; i++) {
      final s = _shape(_keys[i], f);
      final path = Path()..moveTo(s[0], s[1]);
      for (var j = 0; j < 4; j++) {
        final a = j * 6, b = ((j + 1) % 4) * 6;
        path.cubicTo(s[a] + s[a + 4], s[a + 1] + s[a + 5], s[b] + s[b + 2], s[b + 1] + s[b + 3], s[b], s[b + 1]);
      }
      canvas.drawPath(path..close(), Paint()..color = colors[i]..isAntiAlias = true);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_BloomPainter o) => o.f != f || o.dark != dark;
}
