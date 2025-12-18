class Sudocode < Formula
  desc "Git-native spec and issue management for AI-assisted development"
  homepage "https://sudocode.ai"
  url "https://registry.npmjs.org/sudocode/-/sudocode-1.1.15.tgz"
  sha256 "6678ce56a63f92e877d2d794e1094a1c586f8ae357e62dab3f36fa33f13e590b"
  license "Apache-2.0"

  depends_on "node"
  depends_on "python" => :build # for better-sqlite3 native addon

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    # Verify version output
    assert_match version.to_s, shell_output("#{bin}/sudocode --version")

    # Test init creates .sudocode directory
    system bin/"sudocode", "init"
    assert_path_exists testpath/".sudocode"
    assert_path_exists testpath/".sudocode/specs"
    assert_path_exists testpath/".sudocode/issues"
  end
end
