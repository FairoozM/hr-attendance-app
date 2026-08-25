function handler(event) {
  var request = event.request
  var uri = request.uri

  // The JSON API has its own cache behaviours and must never be rewritten: turning a 403 from
  // requireAdmin into the SPA shell would mask an authorization failure as a success.
  if (uri.indexOf('/api') === 0) {
    return request
  }

  // A last segment carrying an extension is a real object in the bucket: a JS bundle, an
  // image, favicon, manifest. Let it resolve, and let a genuine miss stay a miss.
  var lastSlash = uri.lastIndexOf('/')
  var lastSegment = lastSlash === -1 ? uri : uri.substring(lastSlash + 1)
  if (lastSegment.indexOf('.') !== -1) {
    return request
  }

  // Anything else is a client-side route such as /ai/amazon-initial-draft. S3 has no such key
  // and answers 403, so serve the shell and let the React router resolve the path.
  request.uri = '/index.html'
  return request
}
