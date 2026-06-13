// Physical body: position, velocity, friction. Base class for Cell.
export class Mover {
  constructor() {
    this.radius = 20;
    this.x_pos = 0;
    this.y_pos = 0;
    this.x_veloc = 0;
    this.y_veloc = 0;
    this.veloc_max = 100;
    this.friction = 0.997;
  }

  distance_from(other) {
    return Math.hypot(this.x_pos - other.x_pos, this.y_pos - other.y_pos);
  }

  collides_with(other) {
    return this.distance_from(other) < this.radius + other.radius;
  }

  update(frame_delta) {
    // Clamp speed
    if (Math.abs(this.x_veloc) > this.veloc_max)
      this.x_veloc = Math.sign(this.x_veloc) * this.veloc_max;
    if (Math.abs(this.y_veloc) > this.veloc_max)
      this.y_veloc = Math.sign(this.y_veloc) * this.veloc_max;

    // Integrate position, then bleed off speed. Friction is raised to
    // frame_delta so deceleration is framerate-independent (same feel at 30,
    // 60, or 144 Hz, anchored to the 30 fps baseline).
    this.x_pos += this.x_veloc * frame_delta;
    this.y_pos += this.y_veloc * frame_delta;
    const f = this.friction ** frame_delta;
    this.x_veloc *= f;
    this.y_veloc *= f;
  }
}
