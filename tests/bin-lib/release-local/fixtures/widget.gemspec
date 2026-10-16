# frozen_string_literal: true

require_relative "lib/widget/gem/version"

Gem::Specification.new do |spec|
  spec.name          = "widget-gem"
  spec.version       = "1.4.2"
  spec.authors       = ["Example Corp"]
  spec.email         = ["dev@example.com"]

  spec.summary       = "Widget helpers"
  spec.description   = "Widget helper library"
  spec.homepage      = "https://example.com/widget-gem"
  spec.license       = "MIT"

  spec.files         = Dir.glob("lib/**/*.rb")
  spec.require_paths = ["lib"]

  spec.add_dependency "activesupport", ">= 6.0"
  spec.add_development_dependency "rspec", "~> 3.0"
end
