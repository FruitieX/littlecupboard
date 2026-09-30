{
  description = "ForkBasket development environment";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }: let
    systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
    eachSystem = nixpkgs.lib.genAttrs systems;
  in {
    devShells = eachSystem (system: let pkgs = import nixpkgs { inherit system; }; in {
      default = pkgs.mkShell {
        packages = with pkgs; [ nodejs_22 cargo rustc rustfmt clippy pkg-config gcc git ]
          ++ lib.optionals stdenv.hostPlatform.isLinux [ chromium ];
        shellHook = ''
          ${nixpkgs.lib.optionalString (nixpkgs.lib.hasSuffix "linux" system) "export PLAYWRIGHT_CHROMIUM_EXECUTABLE=${pkgs.chromium}/bin/chromium"}
          echo "ForkBasket: npm ci && npm run dev | cargo run --manifest-path backend/Cargo.toml"
        '';
      };
    });
  };
}
