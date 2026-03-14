:Spec.new do |s|
  s.name     = 'boost'
  s.version  = '1.76.0'
  s.summary  = 'Boost C++ Libraries (headers only for RN)'
  s.homepage = 'https://www.boost.org'
  s.license  = { :type => 'Boost Software License' }
  s.source   = {
    :http => 'https://archives.boost.io/release/1.76.0/source/boost_1_76_0.tar.gz',
    :sha256 => 'f0397ba6e982c4450f27bf32a2a83292aba035b827a5623a14636ea583318c41'
  }
  s.requires_arc = false
  s.header_mappings_dir = 'boost'
  s.preserve_paths = 'boost/**/*'
  s.source_files  = 'boost/**/*.h', 'boost/**/*.hpp'
end