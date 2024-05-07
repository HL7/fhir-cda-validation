

export class UnsupportedInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedInvariantError';
  }
}

export class ProfiledToSubProfile extends Error {
  constructor(profile: string) {
    super(`Profile ${profile} does not contain templateId; needs to be handled elsewhere.`);
    this.name = 'ProfiledToSubProfileError';
  }
}

export class UnsupportedValueSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedValueSetError';
  }
}