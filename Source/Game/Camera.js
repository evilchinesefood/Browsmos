// Maps world coordinates to the viewport, smoothly tracking and zooming.
// Viewport dimensions are logical (CSS) pixels, set each frame by World.
export class Camera {
  constructor() {
    this.scale_smoothness = 0.3;
    this.move_smoothness = 0.3;
    this.x = 0;
    this.y = 0;
    this.x_target = 0;
    this.y_target = 0;
    this.scale = 0.5;
    this.scale_target = 1;
    this.viewW = 0;
    this.viewH = 0;
  }

  set_viewport(w, h) {
    this.viewW = w;
    this.viewH = h;
  }

  world_to_viewport_x(x) {
    return x * this.scale + this.viewW / 2 - this.x * this.scale;
  }
  world_to_viewport_y(y) {
    return y * this.scale + this.viewH / 2 - this.y * this.scale;
  }
  viewport_to_world_x(x) {
    return (x + this.x * this.scale - this.viewW / 2) / this.scale;
  }
  viewport_to_world_y(y) {
    return (y + this.y * this.scale - this.viewH / 2) / this.scale;
  }

  update(target_x, target_y, frame_delta) {
    this.x_target = target_x;
    this.y_target = target_y;
    if (this.scale !== this.scale_target)
      this.scale = Math.abs(
        this.scale +
          frame_delta *
            (this.scale_target - this.scale) *
            this.scale_smoothness,
      );
    if (this.x !== this.x_target)
      this.x += frame_delta * (this.x_target - this.x) * this.move_smoothness;
    if (this.y !== this.y_target)
      this.y += frame_delta * (this.y_target - this.y) * this.move_smoothness;
  }
}
